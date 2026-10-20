import { execa } from 'execa'
import { OvdError } from '../errors/ovdError.js'

export interface CommandSpec {
  file: string
  args: string[]
  // The exact command shown to the user (starts with `vega`, never an absolute path).
  display: string
  timeoutMs?: number
  signal?: AbortSignal
  env?: Record<string, string>
}

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  command: string
}

export interface Runner {
  run(spec: CommandSpec): Promise<RunResult>
}

const DEFAULT_TIMEOUT_MS = 15_000

// Non-zero exits are returned, not thrown: callers decide what an exit code means for their tool.
export function createExecaRunner(): Runner {
  return {
    async run(spec) {
      const started = Date.now()
      const result = await execa(spec.file, spec.args, {
        reject: false,
        timeout: spec.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        cancelSignal: spec.signal,
        forceKillAfterDelay: 2_000,
        env: spec.env,
        stdin: 'ignore'
      })
      const command = spec.display
      if (result.isCanceled) throw abortError(spec.signal)
      if (result.timedOut) {
        throw new OvdError(
          'COMMAND_FAILED',
          `${command} did not finish in time`,
          'Check that the device is reachable and the Vega SDK works, then retry',
          { command, timedOut: true }
        )
      }
      if (result.exitCode === undefined) {
        throw new OvdError(
          'COMMAND_FAILED',
          `${command} could not be started`,
          'Check that the Vega SDK is installed (run ovd doctor)',
          { command, cause: result.originalMessage }
        )
      }
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        durationMs: Date.now() - started,
        command
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
