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
  // For commands that act on the folder they run in (`vega project doctor`).
  cwd?: string
  // For commands that print an answer and then wait (`vega devmode login --json` when signed
  // out): once this returns true the runner stops the process and returns what it printed.
  stopWhen?: (stdout: string) => boolean
  // Called with everything printed so far on each new chunk, for commands that print a prompt
  // and then wait (`vega devmode login --json` waiting for the browser sign-in).
  onStdout?: (stdout: string) => void
}

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  command: string
  // Set when `stopWhen` matched and the runner stopped the process.
  stopped?: true
}

export interface Runner {
  run(spec: CommandSpec): Promise<RunResult>
}

const DEFAULT_TIMEOUT_MS = 15_000
// What a shell reports for a process ended by SIGTERM; a stopped command has no exit code.
const STOPPED_EXIT_CODE = 143

// Non-zero exits are returned, not thrown: callers decide what an exit code means for their tool.
export function createExecaRunner(): Runner {
  return {
    async run(spec) {
      const started = Date.now()
      const subprocess = execa(spec.file, spec.args, {
        reject: false,
        timeout: spec.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        cancelSignal: spec.signal,
        forceKillAfterDelay: 2_000,
        env: spec.env,
        cwd: spec.cwd,
        stdin: 'ignore'
      })
      let stopped = false
      const { stopWhen, onStdout } = spec
      if (stopWhen || onStdout) {
        let seen = ''
        subprocess.stdout.on('data', (chunk: Buffer) => {
          seen += chunk.toString()
          onStdout?.(seen)
          if (stopWhen && !stopped && stopWhen(seen)) {
            stopped = true
            subprocess.kill()
          }
        })
      }
      const result = await subprocess
      const command = spec.display
      if (stopped && !result.isCanceled && !result.timedOut) {
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode ?? STOPPED_EXIT_CODE,
          durationMs: Date.now() - started,
          command,
          stopped: true
        }
      }
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
