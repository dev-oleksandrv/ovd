import { createLogged } from '../activity/logged.js'
import type { ActivityLog } from '../activity/activityLog.js'
import { createLogStreamParser } from '../adapters/parseLogStream.js'
import type { Devices } from '../devices/devices.js'
import { offline, onlineTarget } from '../devices/onlineTarget.js'
import { OvdError } from '../errors/ovdError.js'
import { vdaCmd } from '../sdk/commands.js'
import { STREAM_START_MS, type Runner, type RunResult } from '../sdk/runner.js'
import type { SdkLocator } from '../sdk/sdkLocator.js'
import { createLogBuffer } from './logBuffer.js'
import { compileLogFilter, type LogFilter, type LogFilterInput } from './logFilter.js'
import { LOG_BUFFER_SIZE, type LogCounts, type LogEntry } from './types.js'

export interface LogsDeps {
  runner: Runner
  sdk: SdkLocator
  devices: Devices
  activity: ActivityLog
  now: () => Date
}

export interface LogStartOptions {
  device?: string
  filter?: LogFilterInput
  // Entries the session keeps for `entries()` (default LOG_BUFFER_SIZE; 0 keeps none).
  capacity?: number
  signal?: AbortSignal
  // Called for every parsed batch, with the entries that match (possibly none), the counts
  // and the app identities seen so far, so a surface always has fresh counts.
  onEntries?: (entries: LogEntry[], counts: LogCounts, apps: string[]) => void
}

export type LogSessionEnd =
  { reason: 'stopped' } | { reason: 'until' } | { reason: 'ended'; error: OvdError }

export interface LogSession {
  target: { id: string; name: string }
  // The command core runs, as the user would type it.
  command: string
  startedAt: string
  // Resolves once the stream's process group is gone. Never rejects.
  done: Promise<LogSessionEnd>
  // Compiles the filter (INVALID_LOG_FILTER, INVALID_APP_ID) and re-filters the buffer
  // without restarting the stream. `until` stays the one the session started with.
  setFilter(input: LogFilterInput): void
  entries(throughSeq?: number): LogEntry[]
  counts(): LogCounts
  apps(): string[]
  clear(): void
  stop(): Promise<void>
}

export interface Logs {
  start(opts?: LogStartOptions): Promise<LogSession>
}

// A held last entry waits this long for continuation lines before it is delivered.
const FLUSH_IDLE_MS = 250
// Node fires a longer `setTimeout` after 1 ms, so the `until` clock re-arms in steps.
const MAX_TIMER_MS = 2_147_483_647

const LOG_ARGS = ['shell', 'loggingctl', 'log', '-f', '-o', 'short_concise']

// The target's live log (`loggingctl log -f`), parsed and filtered in core for every surface.
// A stream that ends by itself is reported (LOG_STREAM_ENDED); reconnecting is Stage 3.2.
export function createLogs(deps: LogsDeps): Logs {
  const logged = createLogged(deps.activity)

  return {
    async start(opts = {}) {
      // Usage errors and the target come first: they write no activity entry.
      const startFilter = compileLogFilter(opts.filter ?? {}, deps.now())
      const device = await onlineTarget(deps.devices, opts.device)
      if (device.vdaSerial === undefined) throw offline(device)
      const { vegaPath } = await deps.sdk.get()
      if (opts.signal?.aborted) throw abortError(opts.signal)

      const until = startFilter.until
      let filter: LogFilter = startFilter
      const buffer = createLogBuffer(opts.capacity ?? LOG_BUFFER_SIZE, filter.matches)
      const parser = createLogStreamParser({ now: deps.now })
      const controller = new AbortController()
      const abortFromCaller = () => controller.abort()
      opts.signal?.addEventListener('abort', abortFromCaller, { once: true })

      let reachedUntil = false
      let finished = false
      let idleTimer: ReturnType<typeof setTimeout> | undefined
      let clockTimer: ReturnType<typeof setTimeout> | undefined
      let markStarted = (): void => undefined
      const firstChunk = new Promise<void>((resolve) => (markStarted = resolve))

      const endAtUntil = () => {
        if (finished) return
        reachedUntil = true
        finished = true
        controller.abort()
      }

      const deliver = (entries: LogEntry[]) => {
        if (finished || entries.length === 0) return
        let kept = entries
        if (until !== undefined) {
          const late = entries.findIndex((e) => e.deviceTime !== null && Date.parse(e.time) > until)
          if (late !== -1) {
            kept = entries.slice(0, late)
            reachedUntil = true
          }
        }
        if (kept.length > 0) {
          buffer.add(kept)
          opts.onEntries?.(kept.filter(filter.matches), buffer.counts(), buffer.apps())
        }
        if (reachedUntil) endAtUntil()
      }

      const armIdle = () => {
        if (idleTimer !== undefined) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          idleTimer = undefined
          deliver(parser.flush())
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

      const spec = vdaCmd(vegaPath, LOG_ARGS, device.vdaSerial)
      const run: Promise<RunResult> = deps.runner.run({
        ...spec,
        signal: controller.signal,
        stream: {
          onChunk: (chunk) => {
            markStarted()
            armIdle()
            deliver(parser.push(chunk))
          }
        }
      })
      const startedAt = deps.now().toISOString()
      // An `until` already past arms no timer: the backlog is printed up to it, and the first
      // later entry ends the session.
      armClock()

      const cleanUp = () => {
        if (idleTimer !== undefined) clearTimeout(idleTimer)
        if (clockTimer !== undefined) clearTimeout(clockTimer)
        opts.signal?.removeEventListener('abort', abortFromCaller)
      }

      const ended = (exitCode: number, stderr: string) =>
        new OvdError(
          'LOG_STREAM_ENDED',
          `${device.name}’s log stream ended`,
          'The device may have disconnected or rebooted. Check it with ovd devices, then start ovd logs again',
          { exitCode, stderr }
        )

      const done: Promise<LogSessionEnd> = run.then(
        (result) => {
          if (!result.stopped) deliver(parser.end())
          finished = true
          cleanUp()
          if (reachedUntil) return { reason: 'until' }
          if (result.stopped) return { reason: 'stopped' }
          return { reason: 'ended', error: ended(result.exitCode, result.stderr) }
        },
        (error: unknown) => {
          finished = true
          cleanUp()
          return {
            reason: 'ended',
            error:
              error instanceof OvdError
                ? error
                : ended(1, error instanceof Error ? error.message : String(error))
          }
        }
      )

      // The start counts once the first chunk arrived, or the stream still runs after
      // STREAM_START_MS. A run that fails or ends before that is the start's error.
      let startTimer: ReturnType<typeof setTimeout> | undefined
      const started = Promise.race([
        firstChunk,
        new Promise<void>((resolve) => (startTimer = setTimeout(resolve, STREAM_START_MS))),
        run.then(
          async (result) => {
            if (reachedUntil) return
            if (result.stopped) throw abortError(opts.signal)
            throw ended(result.exitCode, result.stderr)
          },
          (error: unknown) => {
            throw error
          }
        )
      ]).finally(() => clearTimeout(startTimer))

      await logged('logs', device.id, filter.args, () => started)

      return {
        target: { id: device.id, name: device.name },
        command: spec.display,
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
        async stop() {
          finished = true
          controller.abort()
          await done
        }
      }
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
