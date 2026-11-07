import type { Command } from 'commander'
import type { CliDeps } from '../program.js'
import { forcedWarning, installedLine } from '../format/install.js'
import { report } from '../report.js'
import { reportContext } from './context.js'

// `ovd install` (Stage 2.3) is kept as an alias of `ovd apps install`, the name the desktop
// echoes (2.4).
export function registerInstall(
  program: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  addInstallCommand(program, deps, setExitCode, 'Same as ovd apps install')
}

// Install a package on the target behind the architecture guard (ADR 0008): a .vpkg, a project
// folder (its build that matches the target) or a package ID, as `ovd apps reinstall` takes.
export function addInstallCommand(
  parent: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void,
  description = 'Install a .vpkg on the target; blocked when the architectures differ'
): void {
  parent
    .command('install')
    .description(description)
    .argument('[app]', '.vpkg, project folder or package ID (default: the open .vpkg or project)')
    .option('--force', 'install even when the package and target architectures differ')
    .action(async (app: string | undefined, opts: { force?: boolean }, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      deps.output.stderr(`Installing ${app ?? 'the open project or .vpkg'}…\n`)
      await report(
        ctx,
        () =>
          deps.ovd().install.install(app, {
            ...(ctx.device === undefined ? {} : { device: ctx.device }),
            ...(opts.force ? { force: true } : {})
          }),
        {
          json: (result) => ({ install: result }),
          human: (result) => {
            if (result.forced) deps.output.stderr(forcedWarning(result))
            return installedLine(result)
          }
        }
      )
    })
}
