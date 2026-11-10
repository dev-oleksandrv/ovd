import {
  isOvdError,
  toErrorJson,
  type ErrorJson,
  type LogEntry,
  type LogSession,
  type Ovd
} from '@ovd/core'
import type { FollowOutcome, IpcResult, LogsFilter, LogsState, LogsUpdate } from '../preload/api'
import { createLogBatcher, realTimers, type Timers } from './logBatcher'
import { toResult } from './ipcResult'

export interface LogsController {
  open(device: string): Promise<LogsState>
  restart(device: string): Promise<LogsState>
  // Main heard of a new target (from the target menu or a device poll).
  targetChanged(target: string | null): Promise<void>
  setFilter(filter: LogsFilter): Promise<IpcResult<null>>
  // The footer toggle, for the running session and every later one; returns the new state.
  setRestartAfterInstall(on: boolean): LogsState
  clear(): void
  // The shown entries (up to `throughSeq`) and the time of the last one, which the CLI echo's
  // `--until` ends at; null without a session.
  exportEntries(throughSeq?: number): { entries: LogEntry[]; until: string | null } | null
  // Stops the session and waits until its process group is gone.
  stop(): Promise<void>
  running(): boolean
  // The device of the current session, if any.
  device(): string | null
  // Before a run's install: the next restart after an install of a session for `device`
  // resolves `restarted`. `cancel` drops the wait.
  armRestart(device: string): RestartArm
  // The run's log step: a session for `device` that restarts after installs is waited on until
  // it restarted (`restarted`, or `timeout` after FOLLOW_TIMEOUT_MS); one with the toggle off is
  // left alone (`skipped`, the user's choice); without one, a session starts (`started`).
  // Never a second session. Rejects with the start's error when a new session fails.
  follow(device: string, arm: RestartArm): Promise<FollowOutcome>
}

export interface RestartArm {
  restarted: Promise<void>
  cancel(): void
}

// A session restarts within about a second of an install (the activity feed's 500 ms tail,
// then the stream's start); past this, the run goes on without waiting.
export const FOLLOW_TIMEOUT_MS = 15_000

// One log session at a time, for one device (spec AC 17). Every update carries the session
// number, so the renderer ignores what an old session still sends.
export function createLogsController(opts: {
  logs: Ovd['logs']
  send: (update: LogsUpdate) => void
  timers?: Timers
}): LogsController {
  const timers = opts.timers ?? realTimers
  const batcher = createLogBatcher({
    send: opts.send,
    ...(opts.timers ? { timers: opts.timers } : {})
  })
  let session = 0
  let state: LogsState = { status: 'idle' }
  let filter: LogsFilter = {}
  // Kept for the app's run (not persisted), carried by every non-idle state.
  let restartAfterInstall = true
  let current: LogSession | undefined
  // Stops whatever the current session number started (a start in progress included).
  let stopCurrent: () => Promise<void> = async () => undefined
  // The current session's start, which `follow` waits for.
  let starting: Promise<LogSession> | undefined
  // Runs waiting for a session of their device to restart after their install.
  const armed = new Set<{ device: string; resolve: () => void }>()

  const push = (n: number, next: LogsState) => {
    if (n !== session) return
    state = next
    batcher.state(n, next)
  }

  const resetFrom = (n: number, s: LogSession | undefined) => {
    if (s) batcher.reset(n, s.entries(), s.counts(), s.apps())
    else batcher.reset(n, [], { lines: 0, errors: 0, shown: 0 }, [])
  }

  const replace = async (): Promise<number> => {
    const stop = stopCurrent
    stopCurrent = async () => undefined
    current = undefined
    batcher.cancel()
    session++
    await stop()
    return session
  }

  const begin = async (device: string): Promise<LogsState> => {
    const n = await replace()
    if (n !== session) return state
    const controller = new AbortController()
    const startFilter = filter
    push(n, { status: 'starting', device, name: device, restartAfterInstall })
    // Set once the start resolved: `onState` needs the session's name and start.
    let started: LogSession | undefined
    const following = (s: LogSession): LogsState => ({
      status: s.state() === 'reconnecting' ? 'reconnecting' : 'running',
      device,
      name: s.target.name,
      startedAt: s.startedAt,
      restartAfterInstall
    })
    const start = opts.logs.start({
      device,
      filter: startFilter,
      restartAfterInstall,
      signal: controller.signal,
      onEntries: (entries, counts, apps) => {
        if (n === session) batcher.append(n, entries, counts, apps)
      },
      onState: () => {
        if (started && n === session) push(n, following(started))
      },
      onRestart: (reason) => {
        if (reason !== 'install' || n !== session) return
        for (const arm of armed) {
          if (arm.device !== device) continue
          armed.delete(arm)
          arm.resolve()
        }
      }
    })
    starting = start
    const startToggle = restartAfterInstall
    stopCurrent = async () => {
      controller.abort()
      await start.then(
        (s) => s.stop(),
        () => undefined
      )
    }
    start.then(
      (s) => {
        if (n !== session) return
        current = s
        started = s
        // The filter or the toggle changed while the session started.
        if (filter !== startFilter) {
          try {
            s.setFilter(filter)
          } catch {
            filter = startFilter
          }
        }
        if (restartAfterInstall !== startToggle) s.setRestartAfterInstall(restartAfterInstall)
        // `following` reads `s.state()`: the session may already be reconnecting.
        push(n, following(s))
        resetFrom(n, s)
        void s.done.then((end) => {
          if (end.reason !== 'ended' || n !== session) return
          push(n, {
            status: 'ended',
            device,
            name: s.target.name,
            startedAt: s.startedAt,
            error: toErrorJson(end.error),
            restartAfterInstall
          })
        })
      },
      (error: unknown) => {
        if (n !== session || (error instanceof Error && error.name === 'AbortError')) return
        push(n, {
          status: 'ended',
          device,
          name: device,
          startedAt: null,
          error: errorJson(error),
          restartAfterInstall
        })
      }
    )
    return state
  }

  const isFor = (device: string | null) => state.status !== 'idle' && state.device === device
  const live = () =>
    state.status === 'starting' || state.status === 'running' || state.status === 'reconnecting'

  return {
    async open(device) {
      if (isFor(device)) {
        batcher.state(session, state)
        resetFrom(session, current)
        return state
      }
      return begin(device)
    },
    restart: (device) => begin(device),
    async targetChanged(target) {
      // No target at all (the only online device dropped, nothing remembered) keeps the session:
      // its device is most likely rebooting, and the session reconnects by itself, with its note
      // and OVD lines, or ends when it gives up. Only another device replaces it.
      if (state.status === 'idle' || target === null || isFor(target)) return
      const n = await replace()
      push(n, { status: 'idle' })
      resetFrom(n, undefined)
    },
    setFilter(next) {
      return toResult(async () => {
        current?.setFilter(next)
        filter = next
        if (current) resetFrom(session, current)
        return null
      })
    },
    setRestartAfterInstall(on) {
      restartAfterInstall = on
      current?.setRestartAfterInstall(on)
      if (state.status !== 'idle') push(session, { ...state, restartAfterInstall: on })
      return state
    },
    clear() {
      if (!current) return
      current.clear()
      resetFrom(session, current)
    },
    exportEntries(throughSeq) {
      if (!current) return null
      const entries = current.entries(throughSeq)
      return { entries, until: entries.at(-1)?.time ?? null }
    },
    async stop() {
      await replace()
      state = { status: 'idle' }
    },
    running: () => live(),
    device: () => (state.status === 'idle' ? null : state.device),
    armRestart(device) {
      let resolve = (): void => undefined
      const restarted = new Promise<void>((r) => (resolve = r))
      const arm = { device, resolve }
      armed.add(arm)
      return { restarted, cancel: () => void armed.delete(arm) }
    },
    async follow(device, arm) {
      if (live() && isFor(device)) {
        if (!restartAfterInstall) {
          arm.cancel()
          return 'skipped'
        }
        let timer: unknown
        const timedOut = new Promise<'timeout'>((resolve) => {
          timer = timers.setTimeout(() => resolve('timeout'), FOLLOW_TIMEOUT_MS)
        })
        const outcome = await Promise.race([
          arm.restarted.then(() => 'restarted' as const),
          timedOut
        ])
        timers.clearTimeout(timer)
        arm.cancel()
        return outcome
      }
      arm.cancel()
      await begin(device)
      // `begin` set it for this session; a failed start also shows in Logs, as an ended session.
      if (starting) await starting
      return 'started'
    }
  }
}

function errorJson(error: unknown): ErrorJson {
  if (isOvdError(error)) return toErrorJson(error)
  return {
    code: 'COMMAND_FAILED',
    message: error instanceof Error ? error.message : String(error),
    hint: 'This is a bug in OVD. Please report it with what you did'
  }
}
