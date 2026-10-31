#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { createOvd, type Ovd } from '@ovd/core'
import { runCli } from './runCli.js'

let ovd: Ovd | undefined

process.exitCode = await runCli(process.argv.slice(2), {
  output: {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text)
  },
  ovd: () => (ovd ??= createOvd({ surface: 'cli' })),
  env: process.env,
  onInterrupt: (abort) => {
    process.once('SIGINT', abort)
    return () => process.off('SIGINT', abort)
  },
  ...(process.stdin.isTTY ? { prompt } : {})
})

// One readline per question: an open one would keep the process alive after the command.
async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}
