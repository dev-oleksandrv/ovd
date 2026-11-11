import { OvdError } from '../../src/index.js'
import type { CommandSpec, Runner, RunResult } from '../../src/sdk/runner.js'

// A fake long-running stream (`loggingctl log -f`): the test prints chunks with `emit` and ends
// it with `end`; an abort of the run's signal resolves it as stopped, as the real runner does.
// A stream with `input` (a console) gets a writer: what core writes is in `written`, and
// `onWrite` answers it, as the console would. Writes after the stream ended are dropped.
export class FakeStream {
  spec?: CommandSpec
  stopped = false
  readonly written: string[] = []
  onWrite: ((text: string) => void) | undefined
  private finish: ((result: RunResult) => void) | undefined

  constructor(opts: { onWrite?: (text: string, stream: FakeStream) => void } = {}) {
    const { onWrite } = opts
    if (onWrite) this.onWrite = (text) => onWrite(text, this)
  }

  get ended(): boolean {
    return this.spec !== undefined && this.finish === undefined
  }

  emit(chunk: string): void {
    if (!this.spec?.stream) throw new Error('FakeStream: not started')
    this.spec.stream.onChunk(chunk)
  }

  end(exitCode = 0, stderr = ''): void {
    this.settle({ exitCode, stderr })
  }

  start(spec: CommandSpec): Promise<RunResult> {
    this.spec = spec
    const result = new Promise<RunResult>((resolve) => (this.finish = resolve))
    spec.stream?.input?.({
      write: (text) => {
        if (this.finish === undefined) return
        this.written.push(text)
        this.onWrite?.(text)
      }
    })
    const stop = () => {
      this.stopped = true
      this.settle({ exitCode: 143, stopped: true })
    }
    if (spec.signal?.aborted) stop()
    else spec.signal?.addEventListener('abort', stop, { once: true })
    return result
  }

  private settle(fields: Partial<RunResult>): void {
    const finish = this.finish
    if (!finish || !this.spec) return
    this.finish = undefined
    finish({
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: 0,
      ...fields,
      command: this.spec.display
    })
  }
}

type Scripted = Partial<Omit<RunResult, 'command'>> | OvdError | FakeStream

// Replays scripted results keyed by the command users see (`spec.display`), and records every call.
// A list replays one result per call, then repeats its last one (state that changes over time).
export class FakeRunner implements Runner {
  readonly calls: CommandSpec[] = []
  private readonly seen = new Map<string, number>()

  constructor(private readonly script: Record<string, Scripted | Scripted[]>) {}

  async run(spec: CommandSpec): Promise<RunResult> {
    this.calls.push(spec)
    const entry = this.script[spec.display]
    if (entry === undefined) throw new Error(`FakeRunner: unexpected command ${spec.display}`)
    const count = this.seen.get(spec.display) ?? 0
    this.seen.set(spec.display, count + 1)
    const scripted = Array.isArray(entry) ? entry[Math.min(count, entry.length - 1)] : entry
    if (scripted === undefined) throw new Error(`FakeRunner: empty script for ${spec.display}`)
    if (scripted instanceof OvdError) throw scripted
    if (scripted instanceof FakeStream) {
      if (!spec.stream) throw new Error(`FakeRunner: ${spec.display} is not a stream`)
      return scripted.start(spec)
    }
    // A waiting command shows its output before it ends, so the caller sees it first.
    if (scripted.stdout) spec.onStdout?.(scripted.stdout)
    return {
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: 0,
      ...scripted,
      command: spec.display
    }
  }

  count(display: string): number {
    return this.seen.get(display) ?? 0
  }
}
