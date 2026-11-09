import { OvdError } from '@ovd/core'
import type { Command } from 'commander'
import type { CliDeps } from '../program.js'
import { doctorText } from '../format/doctor.js'
import { report } from '../report.js'
import { reportContext } from './context.js'

export function registerDoctor(
  program: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  program
    .command('doctor')
    .description('Check the Vega SDK, VDA, project, devices, sign-in and Metro ports')
    .action(async (_opts, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      let failed = false
      // The sign-in probe runs in its own process group, which the terminal's Ctrl+C doesn't
      // reach, and `onInterrupt` replaces the default SIGINT exit (src/exitHooks.ts): Ctrl+C (or a
      // closed stdout pipe) aborts the run, and core stops the command in flight.
      const controller = new AbortController()
      const dispose = deps.onInterrupt(() => controller.abort())
      try {
        await report(
          ctx,
          async () => {
            try {
              const result = await deps.ovd().doctor.run({ signal: controller.signal })
              failed = result.checks.some((c) => c.status === 'fail')
              return result
            } catch (error) {
              if (error instanceof Error && error.name === 'AbortError') {
                throw new OvdError('COMMAND_FAILED', 'Cancelled', 'Run ovd doctor again')
              }
              throw error
            }
          },
          { json: (result) => result, human: doctorText }
        )
      } finally {
        dispose()
      }
      // The report itself succeeded; a failing check still makes the exit code non-zero.
      if (failed) setExitCode(1)
    })
}
