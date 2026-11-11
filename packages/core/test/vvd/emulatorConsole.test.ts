import { afterEach, describe, expect, test, vi } from 'vitest'
import { enableGrpc, isRetryable } from '../../src/vvd/emulatorConsole.js'
import type { OvdError } from '../../src/index.js'
import { CONSOLE_TOKEN, fakeConsole, type FakeConsoleOptions } from '../support/fakeConsole.js'

function run(opts: FakeConsoleOptions = {}, extra: { token?: string; signal?: AbortSignal } = {}) {
  const fake = fakeConsole(opts)
  const result = enableGrpc({
    consolePort: 5554,
    grpcPort: 8554,
    token: extra.token ?? CONSOLE_TOKEN,
    connect: fake.connect,
    timeoutMs: 5_000,
    ...(extra.signal ? { signal: extra.signal } : {})
  })
  return { fake, result }
}

async function failure(promise: Promise<unknown>): Promise<OvdError> {
  try {
    await promise
  } catch (error) {
    return error as OvdError
  }
  throw new Error('expected a failure')
}

afterEach(() => {
  vi.useRealTimers()
})

describe('enableGrpc', () => {
  test('authenticates after the greeting, then turns gRPC on', async () => {
    const { fake, result } = run()
    expect(await result).toEqual({ port: 8554 })
    expect(fake.ports).toEqual([5554])
    expect(fake.written).toEqual([`auth ${CONSOLE_TOKEN}`, 'grpc 8554'])
    expect(fake.sockets[0]?.destroyed).toBe(true)
  })

  test('another program on the port never gets the token', async () => {
    const { fake, result } = run({ greeting: 'SSH-2.0-OpenSSH_9.6\r\nOK\r\n' })
    const error = await failure(result)
    expect(error).toMatchObject({
      code: 'VVD_GRPC_FAILED',
      message: 'Port 5554 isn’t an emulator console'
    })
    expect(isRetryable(error)).toBe(false)
    expect(fake.written).toEqual([])
  })

  test('a wrong token: KO, not retried, and the token is in no error field', async () => {
    const token = 'ovd-wrong-token-value'
    const { fake, result } = run({}, { token })
    const error = await failure(result)
    expect(error).toMatchObject({
      code: 'VVD_GRPC_FAILED',
      message: 'The emulator console rejected the token in ~/.emulator_console_auth_token'
    })
    expect(error.hint).toBeTruthy()
    expect(isRetryable(error)).toBe(false)
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain(token)
    // `grpc` is never sent after a refused auth.
    expect(fake.written).toEqual([`auth ${token}`])
  })

  test('a refused connection is retryable', async () => {
    const { result } = run({ refuse: 'ECONNREFUSED' })
    const error = await failure(result)
    expect(error).toMatchObject({
      code: 'VVD_GRPC_FAILED',
      message: 'Couldn’t reach the emulator console on port 5554 (ECONNREFUSED)'
    })
    expect(isRetryable(error)).toBe(true)
  })

  test('a console that stops answering times out, retryable', async () => {
    vi.useFakeTimers()
    const { fake, result } = run({ silentAfterGreeting: true })
    const settled = failure(result)
    await vi.advanceTimersByTimeAsync(5_000)
    const error = await settled
    expect(error.message).toBe('Couldn’t reach the emulator console on port 5554 (no answer)')
    expect(isRetryable(error)).toBe(true)
    expect(fake.sockets[0]?.destroyed).toBe(true)
  })

  test('nothing sent at all times out too', async () => {
    vi.useFakeTimers()
    const { fake, result } = run({ greeting: null })
    const settled = failure(result)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(fake.sockets[0]?.destroyed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(isRetryable(await settled)).toBe(true)
  })

  test('an abort rejects with an AbortError and closes the socket', async () => {
    const controller = new AbortController()
    const { fake, result } = run({ greeting: null }, { signal: controller.signal })
    const settled = failure(result)
    await Promise.resolve()
    controller.abort()
    expect(await settled).toMatchObject({ name: 'AbortError' })
    expect(fake.sockets[0]?.destroyed).toBe(true)
  })

  test('an already aborted signal connects nowhere', async () => {
    const controller = new AbortController()
    controller.abort()
    const { fake, result } = run({}, { signal: controller.signal })
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(fake.ports).toEqual([])
  })
})
