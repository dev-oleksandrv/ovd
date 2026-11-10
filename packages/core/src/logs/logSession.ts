import type { ActivityFeed } from '../activity/activityFeed.js'
import type { ActivityEntry, ActivityLog } from '../activity/activityLog.js'
import { createLogged } from '../activity/logged.js'
import type { Devices } from '../devices/devices.js'
import { offline, onlineTarget } from '../devices/onlineTarget.js'
import { OvdError } from '../errors/ovdError.js'
import { vdaCmd } from '../sdk/commands.js'
import { STREAM_START_MS, type Runner } from '../sdk/runner.js'
import type { SdkLocator } from '../sdk/sdkLocator.js'
import { createLogBuffer } from './logBuffer.js'
import { compileLogFilter, type LogFilter, type LogFilterInput } from './logFilter.js'
import { createOverlapWindow, type OverlapSnapshot } from './logOverlap.js'
import { startLogStream, type LogStreamRun, type StreamEnd } from './logStreamRun.js'
import { ovdEntry, ovdEventOf } from './ovdEvents.js'
import { LOG_BUFFER_SIZE, type LogCounts, type LogEntry, type OvdEvent } from './types.js'

export interface LogsDeps {
  runner: Runner
  sdk: SdkLocator
  devices: Devices
  activity: ActivityLog
  // Every OVD process's activity entries: installs restart the stream, and installs and
  // launches show as OVD lines.
  feed: ActivityFeed
  now: () => Date
}

export type LogSessionState = 'following' | 'reconnecting'

export interface LogStartOptions {
  device?: string
  filter?: LogFilterInput
  // Entries the session keeps for `entries()` (default LOG_BUFFER_SIZE; 0 keeps none).
  capacity?: number
  signal?: AbortSignal
  // Called for every parsed batch, with the entries that match (possibly none), the counts
  // and the app identities seen so far, so a surface always has fresh counts.
  onEntries?: (entries: LogEntry[], counts: LogCounts, apps: string[]) => void
  // Restart the stream after every install OVD makes on the target (default true, ADR 0014).
  restartAfterInstall?: boolean
  // Called when the session starts reconnecting, and when it follows again.
  onState?: (state: LogSessionState) => void
  // Called when a restarted stream has started, after an install OVD made on the target or a
  // reconnect (beside the OVD line), so a surface can wait for the restart an install causes.
  onRestart?: (reason: 'install' | 'reconnect') => void
}

export type LogSessionEnd =
  { reason: 'stopped' } | { reason: 'until' } | { reason: 'ended'; error: OvdError }

export interface LogSession {
  target: { id: string; name: string }
  // The command core runs, as the user would type it (the first stream's).
  command: string
  startedAt: string
  // Resolves once the stream's process group is gone and the session's activity entries are
  // written. Never rejects.
  done: Promise<LogSessionEnd>
  // Compiles the filter (INVALID_LOG_FILTER, INVALID_APP_ID) and re-filters the buffer
  // without restarting the stream. `until` stays the one the session started with.
  setFilter(input: LogFilterInput): void
  entries(throughSeq?: number): LogEntry[]
  counts(): LogCounts
  apps(): string[]
  clear(): void
  state(): LogSessionState
  setRestartAfterInstall(on: boolean): void
  stop(): Promise<void>
}

export interface Logs {
  start(opts?: LogStartOptions): Promise<LogSession>
}

// A held last entry waits this long for continuation lines before it is delivered.
const FLUSH_IDLE_MS = 250
// Node fires a longer `setTimeout` after 1 ms, so the `until` clock re-arms in steps.
const MAX_TIMER_MS = 2_147_483_647
// While reconnecting, the target is read this often, for at most this long.
export const RECONNECT_POLL_MS = 2_000
export const RECONNECT_TIMEOUT_MS = 300_000
// This many streams in a row that end at once (never started, or ended within
// STREAM_START_MS of their start) give up.
const QUICK_ENDS_LIMIT = 3

const LOG_ARGS = ['shell', 'loggingctl', 'log', '-f', '-o', 'short_concise']

// The target's live log (`loggingctl log -f`), parsed and filtered in core for every surface.
// The session restarts its stream after every install OVD makes on the target, from any OVD
// process (it tails the activity log), and drops the backlog a new stream prints again. A
// stream that ends by itself is reconnected once the target is back; the session gives up
// (LOG_STREAM_ENDED) after RECONNECT_TIMEOUT_MS away or three streams in a row that end at once.
// OVD's own events show inline as OVD lines.
export function createLogs(deps: LogsDeps): Logs {
  const logged = createLogged(deps.activity)

  return {
    async start(opts = {}) {
      // Usage errors and the target come first: they write no activity entry.
      const startFilter = compileLogFilter(opts.filter ?? {}, deps.now())
      const device = await onlineTarget(deps.devices, opts.device)
      const vdaSerial = device.vdaSerial
      if (vdaSerial === undefined) throw offline(device)

      // Everything that can fail once the target is known is the start's outcome: one entry.
      const open = async (): Promise<LogSession> => {
        const { vegaPath } = await deps.sdk.get()
        if (opts.signal?.aborted) throw abortError(opts.signal)

        const until = startFilter.until
        let filter: LogFilter = startFilter
        const buffer = createLogBuffer(opts.capacity ?? LOG_BUFFER_SIZE, filter.matches)
        const overlap = createOverlapWindow()
        let seq = 0
        let restartAfterInstall = opts.restartAfterInstall ?? true
        let state: LogSessionState = 'following'
        let finished = false
        let firstStarted = false
        // From a restart's start until its stream started: installs then only set `queued`.
        let restarting = false
        let queued = false
        let quickEnds = 0
        let lastError: OvdError | undefined
        let current: LogStreamRun | undefined
        let idleTimer: ReturnType<typeof setTimeout> | undefined
        let clockTimer: ReturnType<typeof setTimeout> | undefined
        let pollTimer: ReturnType<typeof setTimeout> | undefined
        let deadlineTimer: ReturnType<typeof setTimeout> | undefined
        // The session's own activity writes, chained; a failed write never ends the session.
        let writes: Promise<void> = Promise.resolve()
        let resolveDone = (_end: LogSessionEnd): void => undefined
        const done = new Promise<LogSessionEnd>((resolve) => (resolveDone = resolve))
        let finishing: Promise<void> | undefined
        let endedWith: LogSessionEnd | undefined

        const write = (entry: Omit<ActivityEntry, 'time' | 'surface'>) => {
          writes = writes.then(() => deps.activity.append(entry).catch(() => undefined))
        }

        const ended = (exitCode: number, stderr: string) =>
          new OvdError(
            'LOG_STREAM_ENDED',
            `${device.name}’s log stream ended`,
            'The device may have disconnected or rebooted. Check it with ovd devices, then start ovd logs again',
            { exitCode, stderr }
          )
        const errorOf = (end: StreamEnd): OvdError => {
          if (end.kind === 'exit') return ended(end.exitCode, end.stderr)
          if (end.kind === 'stopped') return ended(1, '')
          const { error } = end
          return error instanceof OvdError
            ? error
            : ended(1, error instanceof Error ? error.message : String(error))
        }

        const clearTimer = (timer: ReturnType<typeof setTimeout> | undefined) => {
          if (timer !== undefined) clearTimeout(timer)
        }

        // Idempotent: the first reason wins. `done` resolves once the current stream's group
        // is gone and the pending activity writes are done.
        const finish = (end: LogSessionEnd): Promise<void> => {
          finishing ??= (async () => {
            finished = true
            endedWith = end
            clearTimer(idleTimer)
            clearTimer(clockTimer)
            clearTimer(pollTimer)
            clearTimer(deadlineTimer)
            idleTimer = clockTimer = pollTimer = deadlineTimer = undefined
            unsubscribe()
            opts.signal?.removeEventListener('abort', abortFromCaller)
            if (current) await current.stop()
            await writes
            resolveDone(end)
          })()
          return finishing
        }
        const abortFromCaller = () => void finish({ reason: 'stopped' })

        const endAtUntil = () => void finish({ reason: 'until' })

        const emit = (entries: LogEntry[]) => {
          buffer.add(entries)
          opts.onEntries?.(entries.filter(filter.matches), buffer.counts(), buffer.apps())
        }

        const addOvd = (event: OvdEvent, time = deps.now().toISOString()) => {
          if (finished) return
          emit([ovdEntry(event, time, seq++)])
        }

        // A stream's device entries: its overlap snapshot, the `until` cut, then numbered.
        const deliver = (
          stream: LogStreamRun,
          snapshot: OverlapSnapshot | undefined,
          entries: LogEntry[]
        ) => {
          if (finished || stream.stoppedBySession() || entries.length === 0) return
          let kept = snapshot ? entries.filter((e) => !snapshot.drops(e)) : entries
          let reachedUntil = false
          if (until !== undefined) {
            const late = kept.findIndex((e) => e.deviceTime !== null && Date.parse(e.time) > until)
            if (late !== -1) {
              kept = kept.slice(0, late)
              reachedUntil = true
            }
          }
          if (kept.length > 0) {
            const numbered = kept.map((entry) => ({ ...entry, seq: seq++ }))
            for (const entry of numbered) overlap.record(entry)
            emit(numbered)
          }
          if (reachedUntil) endAtUntil()
        }

        const armIdle = () => {
          clearTimer(idleTimer)
          idleTimer = setTimeout(() => {
            idleTimer = undefined
            const stream = current
            if (stream) deliver(stream, snapshots.get(stream), stream.parser.flush())
          }, FLUSH_IDLE_MS)
        }

        const armClock = () => {
          if (until === undefined) return
          const left = until - deps.now().getTime()
          if (left <= 0) return
          clockTimer = setTimeout(
            () => {
              clockTimer = undefined
              if (deps.now().getTime() >= until) endAtUntil()
              else armClock()
            },
            Math.min(left, MAX_TIMER_MS)
          )
        }

        const snapshots = new WeakMap<LogStreamRun, OverlapSnapshot>()
        let command = ''

        // Spawns a stream on `serial`; `onStart` runs when it counts as started.
        const launch = (
          serial: string,
          snapshot: OverlapSnapshot | undefined,
          onStart: () => void
        ): LogStreamRun => {
          const spec = vdaCmd(vegaPath, LOG_ARGS, serial)
          if (command === '') command = spec.display
          const stream: LogStreamRun = startLogStream({
            runner: deps.runner,
            spec,
            now: deps.now,
            onStart,
            onChunk: armIdle,
            // Chunks arrive only after the run started, so `stream` is set by then.
            onEntries: (entries) => deliver(stream, snapshot, entries)
          })
          if (snapshot) snapshots.set(stream, snapshot)
          current = stream
          return stream
        }

        const giveUp = () => {
          if (finished) return
          write({
            action: 'logs.restart',
            target: device.id,
            args: { reason: 'reconnect' },
            result: 'error',
            errorCode: 'LOG_STREAM_ENDED'
          })
          void finish({ reason: 'ended', error: lastError ?? ended(1, '') })
        }

        const armPoll = () => {
          if (finished) return
          pollTimer = setTimeout(() => {
            pollTimer = undefined
            void poll()
          }, RECONNECT_POLL_MS)
        }

        // Reads the target; once it is online, starts a new stream.
        const poll = async () => {
          let serial: string | undefined
          try {
            serial = (await onlineTarget(deps.devices, device.id)).vdaSerial
          } catch {
            serial = undefined
          }
          if (finished) return
          if (serial === undefined) {
            armPoll()
            return
          }
          const stream = launch(serial, overlap.snapshot(), () => {
            if (finished) return
            addOvd({ kind: 'reconnected' })
            write({
              action: 'logs.restart',
              target: device.id,
              args: { reason: 'reconnect' },
              result: 'ok'
            })
            clearTimer(deadlineTimer)
            deadlineTimer = undefined
            state = 'following'
            opts.onState?.('following')
            opts.onRestart?.('reconnect')
          })
          watchEnd(stream)
        }

        const reconnect = () => {
          restarting = false
          queued = false
          if (state === 'following') {
            addOvd({ kind: 'disconnected' })
            state = 'reconnecting'
            opts.onState?.('reconnecting')
            deadlineTimer = setTimeout(() => {
              deadlineTimer = undefined
              giveUp()
            }, RECONNECT_TIMEOUT_MS)
          }
          armPoll()
        }

        // A stream that ends by itself (not stopped by the session, `until` not reached).
        const onStreamEnd = (stream: LogStreamRun, end: StreamEnd) => {
          if (finished || stream.stoppedBySession() || stream !== current) return
          deliver(stream, snapshots.get(stream), stream.parser.end())
          if (finished) return
          clearTimer(idleTimer)
          idleTimer = undefined
          lastError = errorOf(end)
          const startedAt = stream.startedAt()
          const quick =
            startedAt === undefined || deps.now().getTime() - startedAt < STREAM_START_MS
          quickEnds = quick ? quickEnds + 1 : 0
          if (quickEnds >= QUICK_ENDS_LIMIT) {
            giveUp()
            return
          }
          reconnect()
        }

        const watchEnd = (stream: LogStreamRun) => {
          void stream.ended.then((end) => onStreamEnd(stream, end))
        }

        // Restart after an install: stop the stream (its group is gone once `stop` settles),
        // read the target again for a fresh VDA serial, and start a new stream.
        const restart = async () => {
          if (finished) return
          restarting = true
          queued = false
          quickEnds = 0
          const old = current
          if (old) await old.stop()
          if (finished) return
          // The old stream's held entry and partial line are dropped: the new backlog prints
          // them again, whole.
          clearTimer(idleTimer)
          idleTimer = undefined
          let serial: string | undefined
          try {
            serial = (await onlineTarget(deps.devices, device.id)).vdaSerial
          } catch {
            serial = undefined
          }
          if (finished) return
          if (serial === undefined) {
            reconnect()
            return
          }
          const stream = launch(serial, overlap.snapshot(), () => {
            if (finished) return
            restarting = false
            addOvd({ kind: 'restarted', reason: 'install' })
            write({
              action: 'logs.restart',
              target: device.id,
              args: { reason: 'install' },
              result: 'ok'
            })
            opts.onRestart?.('install')
            if (queued) {
              queued = false
              // After this chunk's entries are delivered.
              queueMicrotask(() => void restart())
            }
          })
          watchEnd(stream)
        }

        const onFeed = (entry: ActivityEntry) => {
          if (finished || entry.target !== device.id) return
          const event = ovdEventOf(entry)
          if (!event) return
          addOvd(event, entry.time)
          if (event.kind !== 'install' || event.result !== 'ok') return
          if (!restartAfterInstall || state !== 'following') return
          if (!firstStarted || restarting) queued = true
          else void restart()
        }

        // Subscribed before the first spawn: an install another process makes while the first
        // stream starts is not missed (the feed starts at the file's size on subscribe).
        const unsubscribe = deps.feed.subscribe(onFeed)
        opts.signal?.addEventListener('abort', abortFromCaller, { once: true })

        let markStarted = (): void => undefined
        const firstChunk = new Promise<void>((resolve) => (markStarted = resolve))
        const first = launch(vdaSerial, undefined, () => markStarted())
        const startedAt = deps.now().toISOString()
        // An `until` already past arms no timer: the backlog is printed up to it, and the first
        // later entry ends the session.
        armClock()

        // The start counts once the first chunk arrived, or the stream still runs after
        // STREAM_START_MS. A run that fails or ends before that is the start's error.
        const outcome = await Promise.race([
          firstChunk.then(() => undefined),
          first.ended.then((end) => end)
        ])
        if (outcome !== undefined && endedWith?.reason !== 'until') {
          await finish({ reason: 'stopped' })
          throw outcome.kind === 'stopped'
            ? abortError(opts.signal)
            : outcome.kind === 'error'
              ? outcome.error
              : ended(outcome.exitCode, outcome.stderr)
        }
        firstStarted = true
        watchEnd(first)
        if (queued) {
          queued = false
          void restart()
        }

        return {
          target: { id: device.id, name: device.name },
          command,
          startedAt,
          done,
          setFilter(input) {
            const next = compileLogFilter(input, deps.now())
            filter = next
            buffer.setMatches(next.matches)
          },
          entries: (throughSeq) => buffer.filtered(throughSeq),
          counts: () => buffer.counts(),
          apps: () => buffer.apps(),
          clear: () => buffer.clear(),
          state: () => state,
          setRestartAfterInstall(on) {
            restartAfterInstall = on
            if (!on) queued = false
          },
          async stop() {
            await finish({ reason: 'stopped' })
          }
        }
      }

      return logged('logs', device.id, startFilter.args, open)
    }
  }
}

function abortError(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason
  if (reason instanceof Error && reason.name === 'AbortError') return reason
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}
