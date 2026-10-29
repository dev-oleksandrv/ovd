import { describe, expect, test } from 'vitest'
import { cli } from './support/runCli.js'

describe('ovd hello', () => {
  test('prints the core message', async () => {
    expect(await cli(['hello'])).toEqual({ stdout: 'OVD core is alive\n', stderr: '', exitCode: 0 })
  })

  test.each([[['hello', '--json']], [['--json', 'hello']]])(
    '%j prints one JSON document',
    async (args) => {
      const { stdout, exitCode } = await cli(args)
      expect(JSON.parse(stdout)).toEqual({ ok: true, message: 'OVD core is alive' })
      expect(exitCode).toBe(0)
    }
  )
})

describe('runCli', () => {
  test('an unknown command is a usage error', async () => {
    const { exitCode, stdout } = await cli(['nope'])
    expect(exitCode).toBe(2)
    expect(stdout).toBe('')
  })

  test.each([['--version'], ['--help']])('%s exits 0', async (flag) => {
    expect((await cli([flag])).exitCode).toBe(0)
  })
})
