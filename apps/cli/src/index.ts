#!/usr/bin/env node
import { createOvd, type Ovd } from '@ovd/core'
import { runCli } from './runCli.js'

let ovd: Ovd | undefined

process.exitCode = await runCli(process.argv.slice(2), {
  output: {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text)
  },
  ovd: () => (ovd ??= createOvd({ surface: 'cli' })),
  env: process.env
})
