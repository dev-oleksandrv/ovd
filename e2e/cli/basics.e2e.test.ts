import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { ovd } from '../harness/cli.ts'
import { createSandbox } from '../harness/sandbox.ts'

const pkg = JSON.parse(
  readFileSync(new URL('../../apps/cli/package.json', import.meta.url), 'utf8')
) as { version: string }

describe('ovd', () => {
  test('--version prints the published version, without an SDK', async () => {
    const run = await ovd(createSandbox(), ['--version'])

    expect(run.exitCode).toBe(0)
    expect(run.stdout).toBe(`${pkg.version}\n`)
  })

  test('hello reaches the core', async () => {
    const run = await ovd(createSandbox(), ['hello', '--json'])

    expect(run.exitCode).toBe(0)
    expect(run.json()).toEqual({ ok: true, message: 'OVD core is alive' })
  })

  test('an unknown command is a usage error', async () => {
    const run = await ovd(createSandbox(), ['frobnicate'])

    expect(run.exitCode).toBe(2)
    expect(run.stderr).toContain("unknown command 'frobnicate'")
  })
})
