import { constants } from 'node:os'
import { StringDecoder } from 'node:string_decoder'
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
  // For streams that run for hours (`loggingctl log -f`): each decoded stdout chunk goes to
  // `onChunk` and nothing is kept, there is no timeout, and the command runs in its own process
  // group, which an abort signals as a whole (SIGTERM, then SIGKILL after `graceMs`): signalling
  // only the top `vega` orphans the chain (ARCHITECTURE §8). An abort resolves with `stopped`.
  stream?: { onChunk: (chunk: string) => void; graceMs?: number }
}

export interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  command: string
  // Set when `stopWhen` matched and the runner stopped the process, or a stream was aborted.
  stopped?: true
}

export interface Runner {
  run(spec: CommandSpec): Promise<RunResult>
}

const DEFAULT_TIMEOUT_MS = 15_000
// What a shell reports for a process ended by SIGTERM; a stopped command has no exit code.
const STOPPED_EXIT_CODE = 143
// How long a stopped stream's group gets after SIGTERM before SIGKILL: the same 2 s as the
// `forceKillAfterDelay` of other commands.
export const STREAM_GRACE_MS = 2_000
// How long a stream may print nothing and still count as started (the serial runner and the
// log session wait this long for a first chunk).
export const STREAM_START_MS = 5_000
// A stream keeps only this much of its stderr: enough for an error excerpt.
const STREAM_STDERR_BYTES = 4_096
const GROUP_POLL_MS = 25

// Non-zero exits are returned, not thrown: callers decide what an exit code means for their tool.
export function createExecaRunner(): Runner {
  return {
    async run(spec) {
      if (spec.stream) return runStream(spec, spec.stream)
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

async function runStream(
  spec: CommandSpec,
  stream: NonNullable<CommandSpec['stream']>
): Promise<RunResult> {
  const started = Date.now()
  const command = spec.display
  // No `timeout`, `cancelSignal` or `forceKillAfterDelay`: they signal only the top pid.
  // `detached` makes the child the leader of its own process group.
  const subprocess = execa(spec.file, spec.args, {
    reject: false,
    buffer: false,
    detached: true,
    stdin: 'ignore',
    env: spec.env,
    cwd: spec.cwd
  })
  const decoder = new StringDecoder('utf8')
  subprocess.stdout.on('data', (chunk: Buffer) => {
    const text = decoder.write(chunk)
    if (text !== '') stream.onChunk(text)
  })
  // The listener stays attached for the whole run: with `buffer: false` nothing else drains
  // the pipe, and a full stderr pipe blocks the chain.
  let stderr = ''
  subprocess.stderr.on('data', (chunk: Buffer) => {
    if (stderr.length < STREAM_STDERR_BYTES) {
      stderr = (stderr + chunk.toString()).slice(0, STREAM_STDERR_BYTES)
    }
  })

  let stopping: Promise<void> | undefined
  const exited = subprocess.then(() => undefined)
  const stop = () => {
    stopping ??= stopGroup(subprocess.pid, exited, stream.graceMs ?? STREAM_GRACE_MS)
  }
  const { signal } = spec
  if (signal?.aborted) stop()
  else signal?.addEventListener('abort', stop, { once: true })

  const result = await subprocess
  signal?.removeEventListener('abort', stop)
  if (stopping) await stopping
  const rest = decoder.end()
  if (rest !== '') stream.onChunk(rest)
  const durationMs = Date.now() - started
  if (stopping) {
    return {
      stdout: '',
      stderr,
      exitCode: result.exitCode ?? STOPPED_EXIT_CODE,
      durationMs,
      command,
      stopped: true
    }
  }
  if (result.exitCode === undefined && !result.isTerminated) {
    throw new OvdError(
      'COMMAND_FAILED',
      `${command} could not be started`,
      'Check that the Vega SDK is installed (run ovd doctor)',
      { command, cause: result.originalMessage }
    )
  }
  // Ended by a signal OVD didn't send (SIGHUP, an OOM kill): reported as a shell would.
  const exitCode =
    result.exitCode ??
    (result.signal === undefined ? STOPPED_EXIT_CODE : 128 + constants.signals[result.signal])
  return { stdout: '', stderr, exitCode, durationMs, command }
}

// SIGTERM to the whole group, SIGKILL after `graceMs` if any of it is left. Settles once the
// leader has exited and the group is gone (or was SIGKILLed).
async function stopGroup(
  pid: number | undefined,
  exited: Promise<void>,
  graceMs: number
): Promise<void> {
  if (pid === undefined) return
  signalGroup(pid, 'SIGTERM')
  const deadline = Date.now() + graceMs
  let leaderDone = false
  void exited.then(() => (leaderDone = true))
  while (Date.now() < deadline) {
    if (leaderDone && !groupExists(pid)) return
    await sleep(GROUP_POLL_MS)
  }
  if (groupExists(pid)) signalGroup(pid, 'SIGKILL')
  await exited
}

function signalGroup(pid: number, name: 'SIGTERM' | 'SIGKILL'): void {
  try {
    process.kill(-pid, name)
  } catch (error) {
    if (!isErrno(error, 'ESRCH')) throw error
  }
}

function groupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    // EPERM: a member exists but belongs to another user, which still counts.
    return !isErrno(error, 'ESRCH')
  }
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function abortError(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason
  if (reason instanceof Error && reason.name === 'AbortError') return reason
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}
