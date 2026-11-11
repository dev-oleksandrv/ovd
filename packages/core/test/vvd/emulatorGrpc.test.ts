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
    expect(Object.keys(client('silent').grpc).sort()).toEqual(['sendKey', 'vmState'])
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
})
