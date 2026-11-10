import { SIGHUP_EXIT_CODE, SIGINT_EXIT_CODE, SIGTERM_EXIT_CODE } from './exitCodes.js'
import type { CliDeps } from './program.js'

// The parts of `process` the exit wiring needs, so tests can pass a fake.
export interface ExitProcess {
  on(event: 'exit' | 'SIGHUP' | 'SIGINT' | 'SIGTERM', listener: () => void): unknown
  exit(code: number): void
  stdout: {
    on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown
    off(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown
  }
}

// All of the CLI's exit wiring. The first Ctrl+C, or a closed stdout pipe (`ovd logs | head`),
// aborts the running command, whose SDK process group core stops and waits for. A second
// Ctrl+C, or Ctrl+C with nothing to abort, can't wait: it SIGTERMs every registered group and
// exits 130 at once. SIGTERM does the same with 143, and SIGHUP (the terminal was closed) with
// 129: the detached groups don't get the terminal's SIGHUP themselves. The `exit` listener is the net for every
// other way out: a normal exit, an uncaught exception or an unhandled rejection, since Node
// emits `exit` before it dies on them.
export function installExitHooks(
  proc: ExitProcess,
  stopAll: () => void
): Pick<CliDeps, 'onInterrupt'> {
  let current: (() => void) | undefined
  // Sticky: once a command was asked to stop, the next Ctrl+C forces the exit.
  let interrupted = false
  const interrupt = (): boolean => {
    if (!current || interrupted) return false
    interrupted = true
    current()
    return true
  }

  proc.on('exit', () => stopAll())
  proc.on('SIGHUP', () => {
    stopAll()
    proc.exit(SIGHUP_EXIT_CODE)
  })
  proc.on('SIGTERM', () => {
    stopAll()
    proc.exit(SIGTERM_EXIT_CODE)
  })
  proc.on('SIGINT', () => {
    if (interrupt()) return
    stopAll()
    proc.exit(SIGINT_EXIT_CODE)
  })

  return {
    onInterrupt(abort) {
      current = abort
      // EPIPE only, and through `interrupt`, so repeated pipe errors never force an exit.
      const onPipeError = (error: NodeJS.ErrnoException) => {
        if (error.code === 'EPIPE') interrupt()
      }
      proc.stdout.on('error', onPipeError)
      return () => {
        if (current === abort) current = undefined
        proc.stdout.off('error', onPipeError)
      }
    }
  }
}
