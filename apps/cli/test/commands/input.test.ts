import { OvdError, type PressResult, type TextResult } from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import { cli } from '../support/runCli.js'
import { fail, stubInput } from '../support/sample.js'

const target = { id: 'G070000000000001', name: 'Living room stick' }
const pressed: PressResult = { target, backend: 'inputd-cli', keys: ['down', 'ok'] }
const typed: TextResult = { target, backend: 'inputd-cli', text: 'hello world', length: 11 }

describe('ovd input press', () => {
  test('--json prints the keys pressed; the keys reach core in order', async () => {
    const press = vi.fn(async () => pressed)
    const { stdout, exitCode } = await cli(['input', 'press', 'down', 'ok', '--json'], {
      ovd: stubInput({ press })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, input: pressed })
    expect(exitCode).toBe(0)
    expect(press).toHaveBeenCalledWith(['down', 'ok'], { signal: expect.any(AbortSignal) })
  })

  test('--device reaches core', async () => {
    const press = vi.fn(async () => pressed)
    await cli(['input', 'press', 'up', '--device', 'VirtualDevice'], { ovd: stubInput({ press }) })
    expect(press).toHaveBeenCalledWith(['up'], {
      device: 'VirtualDevice',
      signal: expect.any(AbortSignal)
    })
  })

  test('human output', async () => {
    const { stdout } = await cli(['input', 'press', 'down', 'ok'], {
      ovd: stubInput({ press: async () => pressed })
    })
    expect(stdout).toBe('Pressed down, ok on Living room stick (inputd-cli)\n')
  })

  test('no key is a usage error', async () => {
    const { exitCode } = await cli(['input', 'press'], { ovd: stubInput({}) })
    expect(exitCode).toBe(2)
  })

  test.each([
    ['INVALID_KEY', 2],
    ['KEY_UNSUPPORTED', 2],
    ['INPUT_FAILED', 1],
    ['TARGET_OFFLINE', 4],
    ['NO_TARGET', 4],
    ['DEVICE_NOT_FOUND', 4],
    ['VVD_GRPC_FAILED', 1]
  ] as const)('%s exits %i with the error document', async (code, exit) => {
    const { stdout, exitCode } = await cli(['input', 'press', 'home', '--json'], {
      ovd: stubInput({ press: fail(code) })
    })
    expect(exitCode).toBe(exit)
    expect(JSON.parse(stdout)).toEqual({
      ok: false,
      error: { code, message: `failed: ${code}`, hint: `hint for ${code}` }
    })
  })

  test('Ctrl+C aborts core and reports Cancelled', async () => {
    let interrupt = (): void => undefined
    const press = vi.fn(
      (_keys: string[], opts?: { signal?: AbortSignal }) =>
        new Promise<PressResult>((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          )
        })
    )
    const run = cli(['input', 'press', 'up', '--json'], {
      ovd: stubInput({ press }),
      onInterrupt: (abort) => (interrupt = abort)
    })
    await vi.waitFor(() => expect(press).toHaveBeenCalled())
    interrupt()
    const { stdout, exitCode } = await run
    expect(exitCode).toBe(1)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { message: 'Cancelled' } })
  })
})

describe('ovd input text', () => {
  test('--json prints the text and its length', async () => {
    const text = vi.fn(async () => typed)
    const { stdout, exitCode } = await cli(['input', 'text', 'hello world', '--json'], {
      ovd: stubInput({ text })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, input: typed })
    expect(exitCode).toBe(0)
    expect(text).toHaveBeenCalledWith('hello world', { signal: expect.any(AbortSignal) })
  })

  test('human output gives the length, not the text', async () => {
    const { stdout } = await cli(['input', 'text', 'hello world'], {
      ovd: stubInput({ text: async () => typed })
    })
    expect(stdout).toBe('Typed 11 characters on Living room stick (inputd-cli)\n')
  })

  test('text after -- is taken as it is, even when it starts with -', async () => {
    const text = vi.fn(async () => ({ ...typed, text: '-x', length: 2 }))
    const { exitCode } = await cli(['input', 'text', '--', '-x'], { ovd: stubInput({ text }) })
    expect(exitCode).toBe(0)
    expect(text).toHaveBeenCalledWith('-x', { signal: expect.any(AbortSignal) })
  })

  test('INVALID_TEXT exits 2', async () => {
    const { exitCode, stderr } = await cli(['input', 'text', 'x'], {
      ovd: stubInput({
        text: () =>
          Promise.reject(new OvdError('INVALID_TEXT', 'Nothing to type', 'Give the text to type'))
      })
    })
    expect(exitCode).toBe(2)
    expect(stderr).toBe('Error: Nothing to type\nGive the text to type\n')
  })
})
