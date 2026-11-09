#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { createOvd, processGroups, type Ovd } from '@ovd/core'
import { installExitHooks } from './exitHooks.js'
import { runCli } from './runCli.js'

let ovd: Ovd | undefined
// Before anything runs, and without creating a core: every way out stops the SDK process
// groups still running.
const hooks = installExitHooks(process, () => processGroups.stopAll())

process.exitCode = await runCli(process.argv.slice(2), {
  output: {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text)
  },
  ovd: () => (ovd ??= createOvd({ surface: 'cli' })),
  env: process.env,
  onInterrupt: hooks.onInterrupt,
  stdoutTty: process.stdout.isTTY === true,
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
