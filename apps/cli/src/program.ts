import { Command } from 'commander'
import { hello, type Ovd } from '@ovd/core'
import pkg from '../package.json' with { type: 'json' }
import { registerApps } from './commands/apps.js'
import { registerDevice } from './commands/device.js'
import { registerDevices } from './commands/devices.js'
import { registerDoctor } from './commands/doctor.js'
import { registerInput } from './commands/input.js'
import { registerInstall } from './commands/install.js'
import { registerLogs } from './commands/logs.js'
import { registerPairing } from './commands/pair.js'
import { registerPkg } from './commands/pkg.js'
import { registerProject } from './commands/project.js'
import { registerRun } from './commands/run.js'
import { registerReboot } from './commands/reboot.js'
import { registerScreenshot } from './commands/screenshot.js'
import { registerSetupStick } from './commands/setupStick.js'
import { registerTarget } from './commands/target.js'
import { registerVvd } from './commands/vvd.js'

export interface Output {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

export interface CliDeps {
  output: Output
  // Lazy: `hello`, `--help` and `--version` work without an SDK.
  ovd: () => Ovd
  env: Record<string, string | undefined>
  // Calls `abort` on the first Ctrl+C or a closed stdout pipe until the returned function is
  // called; for commands that must stop their SDK process cleanly instead of being killed with
  // it. A second Ctrl+C stops every SDK process group and exits 130 at once (`exitHooks.ts`).
  onInterrupt: (abort: () => void) => () => void
  // Asks on stderr and resolves with the answer; absent when stdin isn't a terminal, so
  // commands that need input take it from flags instead.
  prompt?: (question: string) => Promise<string>
  // stdout is a terminal: `ovd logs` colors the level letter only then.
  stdoutTty?: boolean
}

export interface GlobalOptions {
  json?: boolean
  device?: string
}

export function createProgram(deps: CliDeps, setExitCode: (code: number) => void): Command {
  const { output } = deps
  const program = new Command()

  program
    .name('ovd')
    .description('Open Vega DevTools')
    .version(pkg.version)
    .option('--json', 'machine-readable output')
    .option('--device <id>', 'device to use instead of the target')
    .configureOutput({ writeOut: output.stdout, writeErr: output.stderr })
    // Before any subcommand is added: subcommands copy it when created, so a missing argument
    // becomes a usage error (exit 2) instead of commander calling process.exit(1).
    .exitOverride()

  program
    .command('hello')
    .description('Smoke test: reach the core and print its reply')
    .action((_opts, cmd: Command) => {
      const { json } = cmd.optsWithGlobals<GlobalOptions>()
      const result = hello()
      output.stdout(json ? `${JSON.stringify(result)}\n` : `${result.message}\n`)
    })

  registerDoctor(program, deps, setExitCode)
  registerDevices(program, deps, setExitCode)
  registerDevice(program, deps, setExitCode)
  registerTarget(program, deps, setExitCode)
  registerVvd(program, deps, setExitCode)
  registerPairing(program, deps, setExitCode)
  registerSetupStick(program, deps, setExitCode)
  registerProject(program, deps, setExitCode)
  registerPkg(program, deps, setExitCode)
  registerApps(program, deps, setExitCode)
  registerInstall(program, deps, setExitCode)
  registerLogs(program, deps, setExitCode)
  registerRun(program, deps, setExitCode)
  registerInput(program, deps, setExitCode)
  registerScreenshot(program, deps, setExitCode)
  registerReboot(program, deps, setExitCode)
  return program
}
