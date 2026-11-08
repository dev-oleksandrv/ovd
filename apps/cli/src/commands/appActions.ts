import { launchNotVerified } from '@ovd/core'
import type { Command } from 'commander'
import type { CliDeps } from '../program.js'
import {
  launchedLine,
  notVerifiedText,
  reinstalledLine,
  restartedLine,
  terminatedLine,
  uninstalledLine
} from '../format/appActions.js'
import { forcedWarning } from '../format/install.js'
import { report } from '../report.js'
import { reportContext } from './context.js'

const APP = 'package or component ID, .vpkg or project folder (default: the open one)'

// The app actions (Stage 2.4): launch, terminate, restart, uninstall, reinstall. Each one is a
// device action, logged by core (ADR 0011). Launch and restart are verified (ADR 0012): an app
// that crashed or isn't running afterwards exits 7, with the launch next to the error.
export function addAppActionCommands(
  apps: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  const device = (d: string | undefined) => (d === undefined ? {} : { device: d })
  const onVerifying = () => deps.output.stderr('Verifying launch…\n')
  const notVerified = {
    failure: launchNotVerified,
    failureHuman: (r: Parameters<typeof launchNotVerified>[0]) =>
      notVerifiedText(r, launchNotVerified(r))
  }

  apps
    .command('launch')
    .description('Launch an app on the target')
    .argument('[app]', APP)
    .action(async (app: string | undefined, _opts, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      deps.output.stderr(`Launching ${app ?? 'the open project’s app'}…\n`)
      await report(ctx, () => deps.ovd().apps.launch(app, { ...device(ctx.device), onVerifying }), {
        json: (launch) => ({ launch }),
        human: launchedLine,
        ...notVerified
      })
    })

  apps
    .command('terminate')
    .description('Stop an app on the target')
    .argument('[app]', APP)
    .option('--force', 'force stop it instead of asking it to stop')
    .action(async (app: string | undefined, opts: { force?: boolean }, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      deps.output.stderr(`Stopping ${app ?? 'the open project’s app'}…\n`)
      await report(
        ctx,
        () =>
          deps.ovd().apps.terminate(app, {
            ...device(ctx.device),
            ...(opts.force ? { force: true } : {})
          }),
        { json: (terminate) => ({ terminate }), human: terminatedLine }
      )
    })

  apps
    .command('restart')
    .description('Stop an app if it runs, then launch it')
    .argument('[app]', APP)
    .action(async (app: string | undefined, _opts, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      deps.output.stderr(`Restarting ${app ?? 'the open project’s app'}…\n`)
      await report(
        ctx,
        () => deps.ovd().apps.restart(app, { ...device(ctx.device), onVerifying }),
        { json: (restart) => ({ restart }), human: restartedLine, ...notVerified }
      )
    })

  apps
    .command('uninstall')
    .description('Uninstall an app you side-loaded from the target')
    .argument('[app]', APP)
    .action(async (app: string | undefined, _opts, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      deps.output.stderr(`Uninstalling ${app ?? 'the open project’s app'}…\n`)
      await report(ctx, () => deps.ovd().apps.uninstall(app, device(ctx.device)), {
        json: (uninstall) => ({ uninstall }),
        human: uninstalledLine
      })
    })

  apps
    .command('reinstall')
    .description('Uninstall an app, then install it again; clears app data (to be verified)')
    .argument('[app]', '.vpkg, project folder or package ID (default: the open .vpkg or project)')
    .option('--force', 'install even when the package and target architectures differ')
    .action(async (app: string | undefined, opts: { force?: boolean }, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      deps.output.stderr(`Reinstalling ${app ?? 'the open project or .vpkg'}…\n`)
      await report(
        ctx,
        () =>
          deps.ovd().apps.reinstall(app, {
            ...device(ctx.device),
            ...(opts.force ? { force: true } : {})
          }),
        {
          json: (reinstall) => ({ reinstall }),
          human: (result) => {
            if (result.forced) deps.output.stderr(forcedWarning(result))
            return reinstalledLine(result)
          }
        }
      )
    })
}
