import type { Command } from 'commander'
import type { CliDeps } from '../program.js'
import { appRows, appsTable } from '../format/apps.js'
import { report } from '../report.js'
import { reportContext } from './context.js'
import { addInstallCommand } from './install.js'

// Apps (Stage 2.4a): what is installed and running on the target. `ovd apps install` is 2.3's
// install under the name the desktop echoes (`ovd install` stays as an alias).
export function registerApps(
  program: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  const apps = program
    .command('apps')
    .description('List the apps on the target, inspect and install them')
    .option('--running', 'only apps that are running')
    .option('--all', 'include system apps')
    .action(async (opts: { running?: boolean; all?: boolean }, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      await report(
        ctx,
        () =>
          deps.ovd().apps.list({
            ...(ctx.device === undefined ? {} : { device: ctx.device }),
            ...(opts.running ? { running: true } : {}),
            ...(opts.all ? { all: true } : {})
          }),
        {
          json: (list) => ({ target: list.target, apps: list.apps }),
          human: (list) => {
            if (list.apps.length > 0) return appsTable(list.apps)
            if (!opts.running) {
              deps.output.stderr('Install one with: ovd apps install <file.vpkg|folder>\n')
            }
            return opts.running
              ? `Nothing running on ${list.target.name}.\n`
              : `No apps you installed on ${list.target.name}.\n`
          }
        }
      )
    })

  apps
    .command('info')
    .description('Show an app’s version, state and components')
    .argument('[app]', 'package or component ID, .vpkg or project folder (default: the open one)')
    .action(async (app: string | undefined, _opts, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      await report(
        ctx,
        () => deps.ovd().apps.info(app, ctx.device === undefined ? {} : { device: ctx.device }),
        {
          json: (info) => ({ target: info.target, app: info.app }),
          human: (info) => appRows(info.app)
        }
      )
    })

  addInstallCommand(apps, deps, setExitCode)
}
