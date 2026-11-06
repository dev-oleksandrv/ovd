import type { Command } from 'commander'
import type { CliDeps } from '../program.js'
import { installedLine } from '../format/install.js'
import { report } from '../report.js'
import { reportContext } from './context.js'

// `ovd install` (Stage 2.3) is kept as an alias of `ovd apps install`, the name the desktop
// echoes (2.4a).
export function registerInstall(
  program: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  addInstallCommand(program, deps, setExitCode, 'Same as ovd apps install')
}

// Install a .vpkg on the target behind the architecture guard (ADR 0008). Project folders and
// package IDs come with the app actions in 2.4b.
export function addInstallCommand(
  parent: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void,
  description = 'Install a .vpkg on the target; blocked when the architectures differ'
): void {
  parent
    .command('install')
    .description(description)
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
