import { Command } from 'commander'
import { hello, type Ovd } from '@ovd/core'
import pkg from '../package.json' with { type: 'json' }
import { registerDevice } from './commands/device.js'
import { registerDevices } from './commands/devices.js'
import { registerDoctor } from './commands/doctor.js'
import { registerPairing } from './commands/pair.js'
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
  // Calls `abort` on Ctrl+C until the returned function is called; for commands that must
  // stop their SDK process cleanly instead of being killed with it.
  onInterrupt: (abort: () => void) => () => void
  // Asks on stderr and resolves with the answer; absent when stdin isn't a terminal, so
  // commands that need input take it from flags instead.
  prompt?: (question: string) => Promise<string>
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
  return program
}
