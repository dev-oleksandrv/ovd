import { OvdError } from '../../src/index.js'
import type { CommandSpec, Runner, RunResult } from '../../src/sdk/runner.js'

type Scripted = Partial<Omit<RunResult, 'command'>> | OvdError

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
