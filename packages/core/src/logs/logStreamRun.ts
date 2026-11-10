import { createLogStreamParser, type LogStreamParser } from '../adapters/parseLogStream.js'
import { STREAM_START_MS, type CommandSpec, type Runner } from '../sdk/runner.js'
import type { LogEntry } from './types.js'

// How one `loggingctl log -f` run ended.
export type StreamEnd =
  | { kind: 'stopped' }
  | { kind: 'exit'; exitCode: number; stderr: string }
  | { kind: 'error'; error: unknown }

export interface LogStreamRun {
  readonly parser: LogStreamParser
  // When it counted as started (`now()` in ms), undefined until then.
  startedAt(): number | undefined
  // True once the session stopped it: its later chunks and held entry are dropped.
  stoppedBySession(): boolean
  // Settles once the run is over, its process group gone. Never rejects.
  readonly ended: Promise<StreamEnd>
  hasEnded(): boolean
  // Marks it stopped by the session, aborts it and waits for its run.
  stop(): Promise<StreamEnd>
}

// One stream of a log session, with its own abort controller, parser and start timer. It
// counts as started at its first chunk, or after STREAM_START_MS if still running; `onStart`
// runs then, before the first chunk's entries go to `onEntries`.
export function startLogStream(opts: {
  runner: Runner
  spec: CommandSpec
  now: () => Date
  onStart: () => void
  // Every chunk, before its entries (the session re-arms its idle flush).
  onChunk: () => void
  onEntries: (entries: LogEntry[]) => void
}): LogStreamRun {
  const controller = new AbortController()
  const parser = createLogStreamParser({ now: opts.now })
  let startedAt: number | undefined
  let stopped = false
  let over = false
  let startTimer: ReturnType<typeof setTimeout> | undefined

  const markStarted = () => {
    if (startedAt !== undefined || over || stopped) return
    startedAt = opts.now().getTime()
    if (startTimer !== undefined) clearTimeout(startTimer)
    startTimer = undefined
    opts.onStart()
  }

  const ended: Promise<StreamEnd> = opts.runner
    .run({
      ...opts.spec,
      signal: controller.signal,
      stream: {
        onChunk: (chunk) => {
          if (stopped) return
          markStarted()
          opts.onChunk()
          opts.onEntries(parser.push(chunk))
        }
      }
    })
    .then(
      (result): StreamEnd =>
        result.stopped
          ? { kind: 'stopped' }
          : { kind: 'exit', exitCode: result.exitCode, stderr: result.stderr },
      (error: unknown): StreamEnd => ({ kind: 'error', error })
    )
    .then((end) => {
      over = true
      if (startTimer !== undefined) clearTimeout(startTimer)
      startTimer = undefined
      return end
    })
  startTimer = setTimeout(markStarted, STREAM_START_MS)

  return {
    parser,
    startedAt: () => startedAt,
    stoppedBySession: () => stopped,
    ended,
    hasEnded: () => over,
    async stop() {
      stopped = true
      if (startTimer !== undefined) clearTimeout(startTimer)
      startTimer = undefined
      controller.abort()
      return ended
    }
  }
}
