import type { CommandSpec, RunResult } from '../../src/sdk/runner.js'
import { FakeStream } from './fakeRunner.js'
import { fixture } from './fixtures.js'

const recorded = (name: string) => fixture(`0.24/inputd-cli-console/${name}`)

export interface InputdStreamOptions {
  // Print the welcome once started (default true).
  welcome?: boolean
  // Answers a console line; undefined: the recorded answer (below); null: no answer at all.
  answer?: (line: string) => string | null | undefined
  // What `exit` does: print `exiting...` and end (default), or nothing.
  onExit?: 'exit' | 'ignore'
}

// The recorded answers of `inputd-cli start` (fixtures/0.24/inputd-cli-console), with the key or
// the text a line names put where the recording has its own.
export function recordedAnswer(line: string): string | null {
  const press = /^button_press (\S+)$/.exec(line)
  if (press?.[1]) {
    return /^KEY_[A-Z]+$/.test(press[1]) && press[1] !== 'KEY_NOPE'
      ? recorded('button-press.txt').replace('KEY_UP', press[1])
      : recorded('invalid-button.txt').replace('KEY_NOPE', press[1])
  }
  const text = /^send_text "((?:[^"\\]|\\.)*)"$/.exec(line)
  if (text?.[1] !== undefined) {
    const typed = text[1].replace(/\\(.)/g, '$1')
    return recorded('send-text.txt').replace('hello world', () => typed)
  }
  return null
}

// A fake `inputd-cli start` console stream for the FakeRunner: it greets, answers each line
// written to its stdin from the recordings, and ends on `exit`.
export class InputdStream extends FakeStream {
  readonly lines: string[] = []
  private pending = ''

  constructor(private readonly opts: InputdStreamOptions = {}) {
    super()
    this.onWrite = (text) => {
      this.pending += text
      let at: number
      while ((at = this.pending.indexOf('\n')) >= 0) {
        const line = this.pending.slice(0, at)
        this.pending = this.pending.slice(at + 1)
        this.lines.push(line)
        this.reply(line)
      }
    }
  }

  override start(spec: CommandSpec): Promise<RunResult> {
    const result = super.start(spec)
    if (this.opts.welcome !== false) queueMicrotask(() => this.emit(recorded('welcome.txt')))
    return result
  }

  private reply(line: string): void {
    if (line === 'exit') {
      if (this.opts.onExit === 'ignore') return
      this.emit(recorded('exit.txt'))
      this.end(0)
      return
    }
    const custom = this.opts.answer?.(line)
    const text = custom === undefined ? recordedAnswer(line) : custom
    if (text !== null) this.emit(text)
  }
}
