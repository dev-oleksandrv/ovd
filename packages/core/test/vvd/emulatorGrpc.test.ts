import { afterEach, describe, expect, test, vi } from 'vitest'
import { createEmulatorGrpc } from '../../src/vvd/emulatorGrpc.js'
import { fakeGrpc, type GrpcAnswer } from '../support/fakeGrpc.js'

const TOKEN = 'ovd-fake-grpc-token'
const SERVICE = '/android.emulation.control.EmulatorController'

function client(answer: GrpcAnswer | ((path: string) => GrpcAnswer)) {
  const fake = fakeGrpc(typeof answer === 'function' ? answer : () => answer)
  return { fake, grpc: createEmulatorGrpc({ port: 8554, token: TOKEN, connect: fake.connect }) }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createEmulatorGrpc', () => {
  test('has only getVmState and sendKey: never getStatus, which kills the Virtual Device', () => {
    expect(Object.keys(client('silent').grpc).sort()).toEqual(['sendKey', 'sendKeys', 'vmState'])
  })

  test('vmState calls getVmState over h2c with the Bearer token', async () => {
    const { fake, grpc } = client('get-vm-state-running.json')
    expect(await grpc.vmState()).toEqual({ state: 1, running: true })
    expect(fake.requests).toEqual([
      {
        authority: 'http://127.0.0.1:8554',
        headers: {
          ':method': 'POST',
          ':path': `${SERVICE}/getVmState`,
          'content-type': 'application/grpc',
          te: 'trailers',
          authorization: `Bearer ${TOKEN}`
        },
        body: Buffer.from('0000000000', 'hex')
      }
    ])
    expect(fake.sessions).toEqual([{ closed: true, destroyed: false }])
  })

  test('sendKey sends a framed KeyboardEvent', async () => {
    const { fake, grpc } = client('send-key.json')
    await grpc.sendKey(158, 'up')
    expect(fake.requests[0]?.headers[':path']).toBe(`${SERVICE}/sendKey`)
    expect(fake.requests[0]?.body.toString('hex')).toBe('000000000708011001189e01')
  })

  test('status 16 in the headers: the token was refused, and it is in no error field', async () => {
    const { grpc } = client('get-vm-state-unauthenticated.json')
    const error: unknown = await grpc.vmState().catch((e: unknown) => e)
    expect(error).toMatchObject({
      code: 'VVD_GRPC_FAILED',
      message: 'Emulator gRPC rejected OVD’s token',
      details: { grpcStatus: '16' }
    })
    expect(JSON.stringify(error)).not.toContain(TOKEN)
  })

  test('a refused connection', async () => {
    const { fake, grpc } = client('refused')
    await expect(grpc.vmState()).rejects.toMatchObject({
      code: 'VVD_GRPC_FAILED',
      message: 'Couldn’t reach emulator gRPC on port 8554',
      details: { cause: 'ECONNREFUSED' }
    })
    expect(fake.sessions[0]?.destroyed).toBe(true)
  })

  test('no answer in 3 s', async () => {
    vi.useFakeTimers()
    const { fake, grpc } = client('silent')
    const result = grpc.vmState().catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(2_999)
    expect(fake.sessions[0]?.destroyed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toMatchObject({
      code: 'VVD_GRPC_FAILED',
      message: 'Emulator gRPC didn’t answer getVmState in time'
    })
    expect(fake.sessions[0]?.destroyed).toBe(true)
  })

  describe('sendKeys', () => {
    const DOWN = { keyCode: 108, eventType: 'down' as const }
    const UP = { keyCode: 108, eventType: 'up' as const }

    test('sends every event in order over one session, then closes it', async () => {
      const { fake, grpc } = client('send-key.json')
      await grpc.sendKeys([DOWN, UP, { keyCode: 96, eventType: 'down' }])
      expect(fake.requests.map((r) => r.body.toString('hex'))).toEqual([
        '0000000004080118' + '6c',
        '000000000608011001186c',
        '0000000004080118' + '60'
      ])
      expect(new Set(fake.requests.map((r) => r.headers[':path']))).toEqual(
        new Set([`${SERVICE}/sendKey`])
      )
      expect(fake.sessions).toEqual([{ closed: true, destroyed: false }])
    })

    test('nothing to send opens no session', async () => {
      const { fake, grpc } = client('send-key.json')
      await grpc.sendKeys([])
      expect(fake.sessions).toEqual([])
    })

    test('an error mid-sequence stops it and destroys the session', async () => {
      let n = 0
      const { fake, grpc } = client(() =>
        ++n === 2 ? 'get-vm-state-unauthenticated.json' : 'send-key.json'
      )
      await expect(grpc.sendKeys([DOWN, UP, DOWN, UP])).rejects.toMatchObject({
        code: 'VVD_GRPC_FAILED',
        message: 'Emulator gRPC rejected OVD’s token'
      })
      expect(fake.requests).toHaveLength(2)
      expect(fake.sessions).toEqual([{ closed: false, destroyed: true }])
    })

    test('the sequence gets 3 s plus 50 ms per event', async () => {
      vi.useFakeTimers()
      const { fake, grpc } = client('silent')
      const result = grpc.sendKeys([DOWN, UP, DOWN, UP]).catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(3_199)
      expect(fake.sessions[0]?.destroyed).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await result).toMatchObject({
        code: 'VVD_GRPC_FAILED',
        message: 'Emulator gRPC didn’t answer sendKey in time'
      })
      expect(fake.sessions[0]?.destroyed).toBe(true)
    })

    test('an abort rejects with an AbortError and destroys the session', async () => {
      const controller = new AbortController()
      const { fake, grpc } = client('silent')
      const result = grpc.sendKeys([DOWN], { signal: controller.signal }).catch((e: unknown) => e)
      controller.abort()
      expect(await result).toMatchObject({ name: 'AbortError' })
      expect(fake.sessions[0]?.destroyed).toBe(true)
    })
  })
})
