import type { Command } from 'commander'
import type { CliDeps } from '../program.js'
import { installedLine } from '../format/install.js'
import { report } from '../report.js'
import { reportContext } from './context.js'

// Install a .vpkg on the target behind the architecture guard (Stage 2.3, ADR 0008). Package
// IDs and project folders come with the Apps screen in 2.4.
export function registerInstall(
  program: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  program
    .command('install')
    .description('Install a .vpkg on the target; blocked when the architectures differ')
    .argument('[file]', '.vpkg file (default: the .vpkg open with ovd open)')
    .option('--force', 'install even when the package and target architectures differ')
    .action(async (file: string | undefined, opts: { force?: boolean }, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      deps.output.stderr(`Installing ${file ?? 'the open .vpkg'}…\n`)
      await report(
        ctx,
        () =>
          deps.ovd().install.install(file, {
            ...(ctx.device === undefined ? {} : { device: ctx.device }),
            ...(opts.force ? { force: true } : {})
          }),
        {
          json: (result) => ({ install: result }),
          human: (result) => {
            if (result.forced) {
              deps.output.stderr(
                `Warning: installed despite the architecture mismatch (--force): package is ${result.package.architecture}, ${result.target.name} is ${result.target.architecture}\n`
              )
            }
            return installedLine(result)
          }
        }
      )
    })
}
