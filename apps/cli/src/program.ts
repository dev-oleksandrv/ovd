import { Command } from 'commander'
import { hello, type Ovd } from '@ovd/core'
import pkg from '../package.json' with { type: 'json' }

export interface Output {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

export interface CliDeps {
  output: Output
  // Lazy: `hello`, `--help` and `--version` work without an SDK.
  ovd: () => Ovd
  env: Record<string, string | undefined>
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

  program
    .command('hello')
    .description('Smoke test: reach the core and print its reply')
    .action((_opts, cmd: Command) => {
      const { json } = cmd.optsWithGlobals<GlobalOptions>()
      const result = hello()
      output.stdout(json ? `${JSON.stringify(result)}\n` : `${result.message}\n`)
    })

  void setExitCode
  return program
}
