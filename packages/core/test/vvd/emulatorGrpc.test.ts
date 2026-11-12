import { afterEach, describe, expect, test, vi } from 'vitest'
import { createEmulatorGrpc } from '../../src/vvd/emulatorGrpc.js'
import { pngSize } from '../../src/screenshot/png.js'
import { fakeGrpc, type GrpcAnswer } from '../support/fakeGrpc.js'
import { fakeGrpcStream, recordedStream } from '../support/fakeGrpcStream.js'
import { frame } from '../../src/vvd/grpcWire.js'

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
  test('has only getVmState, sendKey, getScreenshot and streamScreenshot: never getStatus, which kills the Virtual Device', () => {
    expect(Object.keys(client('silent').grpc).sort()).toEqual([
      'screenshot',
      'sendKey',
      'sendKeys',
      'streamScreenshot',
      'vmState'
    ])
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

  describe('screenshot', () => {
    test('calls getScreenshot with an empty ImageFormat and returns the PNG', async () => {
      const { fake, grpc } = client('get-screenshot.json')
      const png = await grpc.screenshot()
      expect(fake.requests.map((r) => [r.headers[':path'], r.body.toString('hex')])).toEqual([
        [`${SERVICE}/getScreenshot`, '0000000000']
      ])
      expect(pngSize(png)).toEqual({ width: 1920, height: 1080 })
      expect(png.length).toBe(9780)
      expect(fake.sessions).toEqual([{ closed: true, destroyed: false }])
    })

    test('no answer in 10 s', async () => {
      vi.useFakeTimers()
      const { fake, grpc } = client('silent')
      const result = grpc.screenshot().catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(9_999)
      expect(fake.sessions[0]?.destroyed).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await result).toMatchObject({
        code: 'VVD_GRPC_FAILED',
        message: 'Emulator gRPC didn’t answer getScreenshot in time'
      })
    })

    test('an abort rejects with an AbortError and destroys the session', async () => {
      const controller = new AbortController()
      const { fake, grpc } = client('silent')
      const result = grpc.screenshot({ signal: controller.signal }).catch((e: unknown) => e)
      controller.abort()
      expect(await result).toMatchObject({ name: 'AbortError' })
      expect(fake.sessions[0]?.destroyed).toBe(true)
    })

    test('an answer without an image is VVD_GRPC_FAILED', async () => {
      const { grpc } = client('send-key.json')
      await expect(grpc.screenshot()).rejects.toMatchObject({
        code: 'VVD_GRPC_FAILED',
        message: 'Could not read the emulator gRPC getScreenshot answer'
      })
    })
  })

  describe('streamScreenshot', () => {
    const FORMAT = { format: 'rgba8888' as const, width: 960, height: 540 }
    const recorded = recordedStream()
    const [m0, m1, m2] = recorded.messages as [Uint8Array, Uint8Array, Uint8Array]

    function open(signal?: AbortSignal) {
      const fake = fakeGrpcStream()
      const grpc = createEmulatorGrpc({ port: 8554, token: TOKEN, connect: fake.connect })
      const stream = grpc.streamScreenshot(FORMAT, signal ? { signal } : {})
      // The server side of the one request.
      const server = fake.streams[0]
      if (!server) throw new Error('no request')
      return { fake, stream, server, session: () => fake.sessions[0] }
    }

    const tick = () => new Promise((resolve) => setImmediate(resolve))

    test('asks for RGBA8888 at 960x540 with the Bearer token, then yields the frames', async () => {
      const { stream, server, session } = open()
      expect(server.headers).toMatchObject({
        ':path': `${SERVICE}/streamScreenshot`,
        authorization: `Bearer ${TOKEN}`
      })
      expect(server.body.toString('hex')).toBe('0000000008' + '0801' + '18c007' + '209c04')
      server.respond(recorded.headers)
      server.send(m0)
      server.send(m1)
      expect(await stream.next()).toMatchObject({ width: 64, height: 36, seq: 0 })
      expect(await stream.next()).toMatchObject({ width: 64, height: 36, seq: 1 })
      server.end(recorded.trailers)
      // Status 14 when the Virtual Device stops: the stream ended, not failed.
      expect(await stream.next()).toBeNull()
      expect(session()?.destroyed).toBe(false)
    })

    test('frames split across chunks, and two frames in one chunk', async () => {
      const { stream, server } = open()
      server.respond(recorded.headers)
      const f0 = frame(m0)
      server.write(f0.subarray(0, 3))
      server.write(f0.subarray(3, 2000))
      server.write(Buffer.concat([f0.subarray(2000), frame(m1), frame(m2)]))
      expect((await stream.next())?.seq).toBe(0)
      expect((await stream.next())?.seq).toBe(1)
      expect((await stream.next())?.seq).toBe(2)
    })

    test('holds one frame: the stream pauses until next takes it', async () => {
      const { stream, server } = open()
      server.respond(recorded.headers)
      server.send(m0)
      server.send(m1)
      await tick()
      expect(server.paused()).toBe(true)
      expect((await stream.next())?.seq).toBe(0)
      await tick()
      // The second frame was parsed and is held now.
      expect(server.paused()).toBe(true)
      expect((await stream.next())?.seq).toBe(1)
      await tick()
      expect(server.paused()).toBe(false)
    })

    test('the held frame comes before the end', async () => {
      const { stream, server } = open()
      server.respond(recorded.headers)
      server.send(m0)
      server.end(recorded.trailers)
      await tick()
      expect((await stream.next())?.seq).toBe(0)
      expect(await stream.next()).toBeNull()
    })

    test('a clean status 0 end is an end', async () => {
      const { stream, server } = open()
      server.respond(recorded.headers)
      server.send(m0)
      server.end({ 'grpc-status': '0' })
      expect((await stream.next())?.seq).toBe(0)
      expect(await stream.next()).toBeNull()
    })

    test('the session closes (GOAWAY) after frames: an end', async () => {
      const { stream, server, session } = open()
      server.respond(recorded.headers)
      server.send(m0)
      expect((await stream.next())?.seq).toBe(0)
      const next = stream.next()
      session()?.close()
      expect(await next).toBeNull()
    })

    test.each([
      [
        'status 16 in the headers (trailers-only)',
        { ':status': 200, 'grpc-status': '16' },
        undefined,
        'Emulator gRPC rejected OVD’s token'
      ],
      [
        'another status in the trailers',
        recorded.headers,
        { 'grpc-status': '13' },
        'Emulator gRPC streamScreenshot failed'
      ],
      [
        'a trailers-only status 14',
        { ':status': 200, 'grpc-status': '14' },
        undefined,
        'Emulator gRPC streamScreenshot failed'
      ],
      [
        'HTTP 404',
        { ':status': 404 },
        undefined,
        'Emulator gRPC streamScreenshot answered HTTP 404'
      ]
    ])('%s is VVD_GRPC_FAILED, without the token', async (_name, headers, trailers, message) => {
      const { stream, server, session } = open()
      server.respond(headers)
      server.end(trailers)
      const error: unknown = await stream.next().catch((e: unknown) => e)
      expect(error).toMatchObject({ code: 'VVD_GRPC_FAILED', message })
      expect(JSON.stringify(error)).not.toContain(TOKEN)
      expect(session()?.destroyed).toBe(true)
    })

    test.each([
      ['a frame that isn’t RGBA8888', frame(Uint8Array.from([0x0a, 0x00]))],
      ['a compressed frame', Uint8Array.from([1, 0, 0, 0, 0])]
    ])('%s is VVD_GRPC_FAILED', async (_name, bytes) => {
      const { stream, server, session } = open()
      server.respond(recorded.headers)
      server.write(bytes)
      await expect(stream.next()).rejects.toMatchObject({ code: 'VVD_GRPC_FAILED' })
      expect(session()?.destroyed).toBe(true)
    })

    test('a refused connection is VVD_GRPC_FAILED', async () => {
      const { stream, session } = open()
      session()?.error('ECONNREFUSED')
      await expect(stream.next()).rejects.toMatchObject({
        code: 'VVD_GRPC_FAILED',
        message: 'Couldn’t reach emulator gRPC on port 8554',
        details: { cause: 'ECONNREFUSED' }
      })
    })

    test('no first frame in 10 s is VVD_GRPC_FAILED; later silence is fine', async () => {
      vi.useFakeTimers()
      const silent = open()
      silent.server.respond(recorded.headers)
      const result = silent.stream.next().catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(9_999)
      expect(silent.session()?.destroyed).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await result).toMatchObject({
        code: 'VVD_GRPC_FAILED',
        message: 'Emulator gRPC sent no screen frame in 10 s'
      })

      const idle = open()
      idle.server.respond(recorded.headers)
      idle.server.send(m0)
      await vi.advanceTimersByTimeAsync(0)
      expect((await idle.stream.next())?.seq).toBe(0)
      const next = idle.stream.next()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(idle.session()?.destroyed).toBe(false)
      idle.stream.close()
      expect(await next).toBeNull()
    })

    test('close destroys the session and a pending next resolves null', async () => {
      const { stream, server, session } = open()
      server.respond(recorded.headers)
      const next = stream.next()
      stream.close()
      expect(await next).toBeNull()
      expect(await stream.next()).toBeNull()
      expect(session()?.destroyed).toBe(true)
    })

    test('an abort closes it', async () => {
      const controller = new AbortController()
      const { stream, server, session } = open(controller.signal)
      server.respond(recorded.headers)
      server.send(m0)
      await tick()
      controller.abort()
      // The held frame is dropped too.
      expect(await stream.next()).toBeNull()
      expect(session()?.destroyed).toBe(true)
    })
  })
})
