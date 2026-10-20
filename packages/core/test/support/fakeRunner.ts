import { OvdError } from '../../src/index.js'
import type { CommandSpec, Runner, RunResult } from '../../src/sdk/runner.js'

type Scripted = Partial<Omit<RunResult, 'command'>> | OvdError

// Replays scripted results keyed by the command users see (`spec.display`), and records every call.
export class FakeRunner implements Runner {
  readonly calls: CommandSpec[] = []

  constructor(private readonly script: Record<string, Scripted>) {}

  async run(spec: CommandSpec): Promise<RunResult> {
    this.calls.push(spec)
    const scripted = this.script[spec.display]
    if (scripted === undefined) throw new Error(`FakeRunner: unexpected command ${spec.display}`)
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
}
