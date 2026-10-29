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
    .description('Check the Vega SDK, VDA, devices, sign-in and Metro ports')
    .action(async (_opts, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      let failed = false
      await report(
        ctx,
        async () => {
          const result = await deps.ovd().doctor.run()
          failed = result.checks.some((c) => c.status === 'fail')
          return result
        },
        { json: (result) => result, human: doctorText }
      )
      // The report itself succeeded; a failing check still makes the exit code non-zero.
      if (failed) setExitCode(1)
    })
}
