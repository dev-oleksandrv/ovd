import { OvdError } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import { report } from '../src/report.js'

async function run(json: boolean, action: () => Promise<{ n: number }>) {
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  await report(
    {
      output: { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) },
      json,
      setExitCode: (c) => (exitCode = c)
    },
    action,
    { json: (v) => ({ count: v.n }), human: (v) => `${v.n} things\n` }
  )
  return { stdout, stderr, exitCode }
}

const sdkMissing = () =>
  Promise.reject(new OvdError('SDK_NOT_FOUND', 'No Vega SDK found', 'Install the Vega SDK'))

describe('report', () => {
  test('success', async () => {
    expect(await run(true, async () => ({ n: 2 }))).toEqual({
      stdout: '{"ok":true,"count":2}\n',
      stderr: '',
      exitCode: 0
    })
    expect((await run(false, async () => ({ n: 2 }))).stdout).toBe('2 things\n')
  })

  test('an OvdError in JSON mode is one document on stdout with its exit code', async () => {
    const { stdout, stderr, exitCode } = await run(true, sdkMissing)
    expect(JSON.parse(stdout)).toEqual({
      ok: false,
      error: { code: 'SDK_NOT_FOUND', message: 'No Vega SDK found', hint: 'Install the Vega SDK' }
    })
    expect(stderr).toBe('')
    expect(exitCode).toBe(3)
  })

  test('an OvdError in human mode goes to stderr', async () => {
    expect(await run(false, sdkMissing)).toEqual({
      stdout: '',
      stderr: 'Error: No Vega SDK found\nInstall the Vega SDK\n',
      exitCode: 3
    })
  })

  describe('a returned failure', () => {
    const notVerified = new OvdError(
      'LAUNCH_NOT_VERIFIED',
      'Launch reported success, but the app crashed',
      'Launch it again'
    )
    async function returned(json: boolean, failureHuman?: (v: { n: number }) => string) {
      let stdout = ''
      let stderr = ''
      let exitCode = 0
      await report(
        {
          output: { stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) },
          json,
          setExitCode: (c) => (exitCode = c)
        },
        async () => ({ n: 0 }),
        {
          json: (v) => ({ launch: { n: v.n } }),
          human: (v) => `${v.n} things\n`,
          failure: (v) => (v.n === 0 ? notVerified : undefined),
          ...(failureHuman ? { failureHuman } : {})
        }
      )
      return { stdout, stderr, exitCode }
    }

    test('JSON: one document with the error and the result, and the error’s exit code', async () => {
      const { stdout, stderr, exitCode } = await returned(true)
      expect(stdout.trim().split('\n')).toHaveLength(1)
      expect(JSON.parse(stdout)).toEqual({
        ok: false,
        error: {
          code: 'LAUNCH_NOT_VERIFIED',
          message: 'Launch reported success, but the app crashed',
          hint: 'Launch it again'
        },
        launch: { n: 0 }
      })
      expect(stderr).toBe('')
      expect(exitCode).toBe(7)
    })

    test('human: the message and hint on stderr, nothing on stdout', async () => {
      expect(await returned(false)).toEqual({
        stdout: '',
        stderr: 'Error: Launch reported success, but the app crashed\nLaunch it again\n',
        exitCode: 7
      })
    })

    test('human: its own text when given', async () => {
      const { stdout, stderr } = await returned(false, (v) => `crashed ${v.n}\n`)
      expect(stdout).toBe('')
      expect(stderr).toBe('crashed 0\n')
    })
  })

  test('any other error is UNEXPECTED_ERROR, exit 1', async () => {
    const { stdout, exitCode } = await run(true, () => Promise.reject(new Error('boom')))
    expect(JSON.parse(stdout)).toMatchObject({
      ok: false,
      error: { code: 'UNEXPECTED_ERROR', message: 'boom' }
    })
    expect(exitCode).toBe(1)
  })
})
