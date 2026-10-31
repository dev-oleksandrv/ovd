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
  opts: {
    ovd?: Partial<Ovd>
    env?: Record<string, string>
    // Receives the Ctrl+C handler a command installs, so a test can press Ctrl+C.
    onInterrupt?: (abort: () => void) => void
    // Answers to prompts, in order; without it the CLI runs as if stdin weren't a terminal.
    answers?: string[]
  } = {}
): Promise<CliRun> {
  let stdout = ''
  let stderr = ''
  const answers = opts.answers ? [...opts.answers] : undefined
  const exitCode = await runCli(args, {
    output: { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) },
    ovd: () => {
      if (!opts.ovd) throw new Error('this command should not need core')
      return opts.ovd as Ovd
    },
    env: opts.env ?? {},
    onInterrupt: (abort) => {
      opts.onInterrupt?.(abort)
      return () => undefined
    },
    ...(answers
      ? {
          prompt: async (question: string) => {
            stderr += question
            return answers.shift() ?? ''
          }
        }
      : {})
  })
  return { stdout, stderr, exitCode }
}
