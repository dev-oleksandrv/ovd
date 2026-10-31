import { describe, expect, test, vi } from 'vitest'
import type { Devmode, LoginPrompt } from '@ovd/core'
import { cli } from '../support/runCli.js'
import { fail, stick, stubDevmode } from '../support/sample.js'

const prompt: LoginPrompt = {
  verificationUri: 'https://amazon.com/us/code?cbl-code=ABC123',
  userCode: 'ABC123'
}

const enabled = { enabled: true as const, command: 'vega devmode enable-device --code ABC123' }

// Signed out: the sign-in shows its prompt first, then succeeds.
const loginWithPrompt: Devmode['login'] = async (opts) => {
  opts?.onPrompt?.(prompt)
  return { signedIn: true }
}

function happy(overrides: Partial<Devmode> = {}) {
  const enableDevice = vi.fn(async () => enabled)
  const waitForStick = vi.fn(async () => stick)
  return {
    enableDevice,
    waitForStick,
    ovd: stubDevmode({ login: loginWithPrompt, enableDevice, waitForStick, ...overrides })
  }
}

const lines = (stdout: string) =>
  stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as unknown)

describe('ovd setup-stick', () => {
  test('--code --json prints each step as a JSON line, then the stick', async () => {
    const { ovd, enableDevice } = happy()
    const { stdout, exitCode } = await cli(['setup-stick', '--code', 'abc-123', '--json'], { ovd })
    expect(lines(stdout)).toEqual([
      { step: 'login', status: 'pending', ...prompt },
      { step: 'login', status: 'done' },
      { step: 'enable', status: 'done' },
      { step: 'connect', status: 'waiting' },
      { ok: true, device: stick }
    ])
    expect(enableDevice).toHaveBeenCalledWith({ code: 'ABC123' })
    expect(exitCode).toBe(0)
  })

  test('the sign-in link and code go to stderr in human mode', async () => {
    const { ovd } = happy()
    const { stdout, stderr } = await cli(['setup-stick', '--code', 'ABC123'], { ovd })
    expect(stderr).toContain(
      'Open https://amazon.com/us/code?cbl-code=ABC123 in your browser and enter the code ABC123'
    )
    expect(stdout).toBe(
      'Fire TV stick · G070000000000001 · USB · armv7 · OS 2.0 — now in Devices\n'
    )
  })

  test('--vendor is passed through', async () => {
    const { ovd, enableDevice } = happy()
    await cli(['setup-stick', '--code', 'ABC123', '--vendor', 'M0000000000001'], { ovd })
    expect(enableDevice).toHaveBeenCalledWith({ code: 'ABC123', vendor: 'M0000000000001' })
  })

  test('--wifi stops once Developer Mode is on', async () => {
    const { ovd, waitForStick } = happy()
    const { stdout } = await cli(['setup-stick', '--code', 'ABC123', '--wifi', '--json'], { ovd })
    expect(lines(stdout).at(-1)).toEqual({ ok: true, device: null })
    expect(waitForStick).not.toHaveBeenCalled()
  })

  test('in a terminal it shows the TV steps and asks again for a malformed code', async () => {
    const { ovd, enableDevice } = happy()
    const { stderr, exitCode } = await cli(['setup-stick'], { ovd, answers: ['', 'AB1', 'ab1234'] })
    expect(stderr).toContain('Select the device name 7 times')
    expect(stderr).toContain('The code from the TV has 6 letters and digits')
    expect(enableDevice).toHaveBeenCalledWith({ code: 'AB1234' })
    expect(exitCode).toBe(0)
  })

  test.each([
    ['without a terminal or --code', ['setup-stick', '--json']],
    ['a malformed --code', ['setup-stick', '--code', 'AB1', '--json']]
  ])('%s is a usage error before signing in', async (_name, args) => {
    const login = vi.fn(loginWithPrompt)
    const { stdout, exitCode } = await cli(args, { ovd: stubDevmode({ login }) })
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'INVALID_CODE' } })
    expect(login).not.toHaveBeenCalled()
    expect(exitCode).toBe(2)
  })

  test.each([
    ['login', 'NOT_SIGNED_IN', 5],
    ['enableDevice', 'CODE_REJECTED', 5],
    ['enableDevice', 'VENDOR_REQUIRED', 5],
    ['enableDevice', 'SDK_MANAGER_MISSING', 3],
    ['waitForStick', 'DEVICE_NOT_FOUND', 4]
  ] as const)('%s failing with %s exits %i', async (step, code, exit) => {
    const { ovd } = happy({ [step]: fail(code) })
    const { stdout, exitCode } = await cli(['setup-stick', '--code', 'ABC123', '--json'], { ovd })
    expect(lines(stdout).at(-1)).toMatchObject({ ok: false, error: { code } })
    expect(exitCode).toBe(exit)
  })

  test('Ctrl+C aborts the sign-in', async () => {
    let interrupt = (): void => undefined
    const login: Devmode['login'] = (opts) =>
      new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
        interrupt()
      })
    const { stdout, exitCode } = await cli(['setup-stick', '--code', 'ABC123', '--json'], {
      ovd: stubDevmode({ login }),
      onInterrupt: (abort) => (interrupt = abort)
    })
    expect(JSON.parse(stdout)).toMatchObject({
      ok: false,
      error: { code: 'COMMAND_FAILED', message: 'Cancelled' }
    })
    expect(exitCode).toBe(1)
  })
})
