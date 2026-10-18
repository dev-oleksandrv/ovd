import { Command } from 'commander'
import { hello } from '@ovd/core'
import pkg from '../package.json' with { type: 'json' }

export interface Output {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

const processOutput: Output = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text)
}

export function createProgram(output: Output = processOutput): Command {
  const program = new Command()

  program
    .name('ovd')
    .description('Open Vega DevTools')
    .version(pkg.version)
    .configureOutput({ writeOut: output.stdout, writeErr: output.stderr })

  program
    .command('hello')
    .description('Smoke test: reach the core and print its reply')
    .option('--json', 'machine-readable output')
    .action((opts: { json?: boolean }) => {
      const result = hello()
      output.stdout(opts.json ? `${JSON.stringify(result)}\n` : `${result.message}\n`)
    })

  return program
}
