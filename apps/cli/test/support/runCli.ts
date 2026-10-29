import type { Ovd } from '@ovd/core'
import { runCli } from '../../src/runCli.js'

export interface CliRun {
  stdout: string
  stderr: string
  exitCode: number
}

// Runs the CLI in-process with captured output; `ovd` defaults to one that must not be used.
export async function cli(
  args: string[],
  opts: { ovd?: Partial<Ovd>; env?: Record<string, string> } = {}
): Promise<CliRun> {
  let stdout = ''
  let stderr = ''
  const exitCode = await runCli(args, {
    output: { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) },
    ovd: () => {
      if (!opts.ovd) throw new Error('this command should not need core')
      return opts.ovd as Ovd
    },
    env: opts.env ?? {}
  })
  return { stdout, stderr, exitCode }
}
