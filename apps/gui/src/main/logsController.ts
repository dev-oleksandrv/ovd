import {
  isOvdError,
  logTextAll,
  toErrorJson,
  type ErrorJson,
  type LogSession,
  type Ovd
} from '@ovd/core'
import type { IpcResult, LogsFilter, LogsState, LogsUpdate } from '../preload/api'
import { createLogBatcher, type Timers } from './logBatcher'
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
  // The shown lines as plain text (the `ovd logs` format); null without a session.
  exportText(throughSeq?: number): { text: string; lines: number } | null
  // Stops the session and waits until its process group is gone.
  stop(): Promise<void>
  running(): boolean
  // The device of the current session, if any.
  device(): string | null
}

// One log session at a time, for one device (spec AC 17). Every update carries the session
// number, so the renderer ignores what an old session still sends.
export function createLogsController(opts: {
  logs: Ovd['logs']
  send: (update: LogsUpdate) => void
  timers?: Timers
}): LogsController {
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
    const starting = opts.logs.start({
      device,
      filter: startFilter,
      restartAfterInstall,
      signal: controller.signal,
      onEntries: (entries, counts, apps) => {
        if (n === session) batcher.append(n, entries, counts, apps)
      },
      onState: () => {
        if (started && n === session) push(n, following(started))
      }
    })
    const startToggle = restartAfterInstall
    stopCurrent = async () => {
      controller.abort()
      await starting.then(
        (s) => s.stop(),
        () => undefined
      )
    }
    starting.then(
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
      if (state.status === 'idle' || isFor(target)) return
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
    exportText(throughSeq) {
      if (!current) return null
      const entries = current.entries(throughSeq)
      return { text: logTextAll(entries), lines: entries.length }
    },
    async stop() {
      await replace()
      state = { status: 'idle' }
    },
    running: () =>
      state.status === 'starting' || state.status === 'running' || state.status === 'reconnecting',
    device: () => (state.status === 'idle' ? null : state.device)
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
