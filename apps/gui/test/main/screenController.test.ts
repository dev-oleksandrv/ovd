// @vitest-environment node
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  OvdError,
  type CapturesList,
  type Device,
  type LiveOptions,
  type LiveScreen,
  type ScreenFrame,
  type ScreenshotResult
} from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import type { ScreenFramePush, ScreenState } from '../../src/preload/api'
import { createScreenController } from '../../src/main/screenController'

const VVD = { id: 'VirtualDevice', name: 'Vega Virtual Device' }
const frameOf = (seq: number): ScreenFrame => ({
  width: 1,
  height: 1,
  seq,
  timestampUs: 1_000 + seq,
  pixels: Uint8Array.from([seq, 0, 0, 255])
})

const device = (status: Device['status']): Device => ({
  ...VVD,
  vdaSerial: 'emulator-5554',
  kind: 'vvd',
  connection: 'local',
  status,
  isTarget: true,
  saved: false
})

// A live stream the test feeds: `push` a frame, `end` it (null or an error).
function fakeLive() {
  const queue: (ScreenFrame | null | OvdError)[] = []
  let waiter: ((v: ScreenFrame | null | OvdError) => void) | undefined
  const state = { closed: false, nexts: 0 }
  const give = (v: ScreenFrame | null | OvdError) => {
    if (waiter) {
      const w = waiter
      waiter = undefined
      w(v)
    } else queue.push(v)
  }
  const live: LiveScreen = {
    target: VVD,
    backend: 'grpc',
    async next() {
      state.nexts++
      const v =
        queue.length > 0
          ? queue.shift()
          : await new Promise<ScreenFrame | null | OvdError>((r) => (waiter = r))
      if (v instanceof OvdError) throw v
      return v ?? null
    },
    close: () => {
      state.closed = true
      give(null)
    }
  }
  return {
    live,
    state,
    push: (f: ScreenFrame) => give(f),
    end: (e: OvdError | null = null) => give(e)
  }
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r))
}

function setup(opts: {
  lives?: (() => Promise<LiveScreen>)[]
  statuses?: (Device['status'] | 'gone')[]
  take?: () => Promise<ScreenshotResult>
  dir?: string
}) {
  const frames: ScreenFramePush[] = []
  const states: ScreenState[] = []
  const captures: CapturesList[] = []
  const liveCalls: LiveOptions[] = []
  const lives = opts.lives ?? [async () => fakeLive().live]
  let reads = 0
  const statuses = opts.statuses ?? ['online']
  const sleeps: number[] = []
  const controller = createScreenController({
    screen: {
      live: async (o = {}) => {
        liveCalls.push(o)
        const open = lives[Math.min(liveCalls.length, lives.length) - 1]
        if (!open) throw new Error('no live')
        return open()
      }
    },
    devices: {
      get: async () => {
        const status = statuses[Math.min(reads++, statuses.length - 1)] ?? 'online'
        if (status === 'gone') throw new OvdError('DEVICE_NOT_FOUND', 'No device', 'h')
        return device(status)
      }
    },
    screenshot: {
      take: vi.fn(opts.take ?? (() => Promise.reject(new Error('unexpected take')))),
      captures: async () => ({ dir: '/captures', captures: [] }),
      dir: () => opts.dir ?? '/captures'
    },
    sendFrame: (f) => frames.push(f),
    sendState: (s) => states.push(s),
    sendCaptures: (l) => captures.push(l),
    sleep: async (ms) => void sleeps.push(ms),
    readFile: async () => Uint8Array.from([0x89, 0x50])
  })
  return {
    controller,
    frames,
    states,
    captures,
    liveCalls,
    sleeps,
    reads: () => reads,
    statuses: () => states.map((s) => s.status)
  }
}

const offline = (message = 'off') =>
  new OvdError('VVD_GRPC_FAILED', message, 'Turn it on with ovd vvd start')

describe('screen controller', () => {
  test('start goes connecting, then live, and sends the first frame', async () => {
    const stream = fakeLive()
    const s = setup({ lives: [async () => stream.live] })
    expect(s.controller.start('VirtualDevice')).toMatchObject({ status: 'connecting' })
    stream.push(frameOf(0))
    await flush()
    expect(s.statuses()).toEqual(['connecting', 'live'])
    expect(s.liveCalls[0]).toMatchObject({ device: 'VirtualDevice', quiet: false })
    expect(s.frames).toEqual([
      { seq: 1, width: 1, height: 1, timestampUs: 1_000, pixels: Uint8Array.from([0, 0, 0, 255]) }
    ])
  })

  test('the next frame goes only after the last was acked; stale and repeated acks are ignored', async () => {
    const stream = fakeLive()
    const s = setup({ lives: [async () => stream.live] })
    s.controller.start('VirtualDevice')
    stream.push(frameOf(0))
    stream.push(frameOf(1))
    stream.push(frameOf(2))
    await flush()
    expect(s.frames.map((f) => f.seq)).toEqual([1])
    // Not pulled from core either: core holds the emulator back.
    expect(stream.state.nexts).toBe(1)
    s.controller.ack(0)
    s.controller.ack(7)
    await flush()
    expect(s.frames.map((f) => f.seq)).toEqual([1])
    s.controller.ack(1)
    await flush()
    expect(s.frames.map((f) => f.seq)).toEqual([1, 2])
    s.controller.ack(1)
    await flush()
    expect(s.frames.map((f) => f.seq)).toEqual([1, 2])
    s.controller.ack(2)
    await flush()
    expect(s.frames.map((f) => f.seq)).toEqual([1, 2, 3])
  })

  test.each([[-1], [1.5], ['1'], [null]])('ack(%j) is a TypeError', (seq) => {
    const s = setup({})
    expect(() => s.controller.ack(seq)).toThrow(TypeError)
  })

  test.each([[''], [42], [undefined]])('start(%j) is a TypeError', (value) => {
    const s = setup({})
    expect(() => s.controller.start(value)).toThrow(TypeError)
  })

  test('start for the same device while live replays it; another device closes the old one', async () => {
    const first = fakeLive()
    const second = fakeLive()
    const s = setup({ lives: [async () => first.live, async () => second.live] })
    s.controller.start('VirtualDevice')
    first.push(frameOf(0))
    await flush()
    expect(s.controller.start('VirtualDevice')).toMatchObject({ status: 'live' })
    expect(s.liveCalls).toHaveLength(1)
    s.controller.start('emulator-5556')
    await flush()
    expect(first.state.closed).toBe(true)
    expect(s.liveCalls).toHaveLength(2)
    expect(s.liveCalls[1]).toMatchObject({ device: 'emulator-5556', quiet: false })
  })

  test('the stream ends, the device reads online twice, then offline: no signal', async () => {
    const stream = fakeLive()
    const s = setup({ lives: [async () => stream.live], statuses: ['online', 'online', 'stopped'] })
    s.controller.start('VirtualDevice')
    stream.push(frameOf(0))
    await flush()
    s.controller.ack(1)
    stream.end()
    await flush()
    expect(s.reads()).toBe(3)
    expect(s.sleeps).toEqual([1_000, 1_000])
    expect(s.statuses()).toEqual(['connecting', 'live', 'no-signal'])
    expect(s.liveCalls).toHaveLength(1)
  })

  test('a device VDA no longer lists is no signal', async () => {
    const stream = fakeLive()
    const s = setup({ lives: [async () => stream.live], statuses: ['gone'] })
    s.controller.start('VirtualDevice')
    stream.push(frameOf(0))
    await flush()
    s.controller.ack(1)
    stream.end()
    await flush()
    expect(s.statuses().at(-1)).toBe('no-signal')
  })

  test('the Virtual Device restarted (still online after the end): reopened once, quietly', async () => {
    const first = fakeLive()
    const second = fakeLive()
    const s = setup({ lives: [async () => first.live, async () => second.live] })
    s.controller.start('VirtualDevice')
    first.push(frameOf(0))
    await flush()
    s.controller.ack(1)
    first.end()
    await flush()
    expect(s.liveCalls.map((c) => c.quiet)).toEqual([false, true])
    second.push(frameOf(0))
    await flush()
    expect(s.statuses()).toEqual(['connecting', 'live', 'connecting', 'live'])
    expect(s.frames.map((f) => f.seq)).toEqual([1, 2])
  })

  test('VVD_GRPC_FAILED while online: one reopen, and when that fails too, error', async () => {
    const stream = fakeLive()
    const s = setup({
      lives: [async () => stream.live, () => Promise.reject(offline('refused again'))]
    })
    s.controller.start('VirtualDevice')
    stream.push(frameOf(0))
    await flush()
    s.controller.ack(1)
    stream.end(offline('Emulator gRPC streamScreenshot failed'))
    await flush()
    expect(s.liveCalls).toHaveLength(2)
    expect(s.states.at(-1)).toMatchObject({
      status: 'error',
      error: { code: 'VVD_GRPC_FAILED', message: 'refused again' }
    })
  })

  test('an offline target at start is no signal; another error is error', async () => {
    const off = setup({
      lives: [() => Promise.reject(new OvdError('TARGET_OFFLINE', 'stopped', 'h'))]
    })
    off.controller.start('VirtualDevice')
    await flush()
    expect(off.statuses()).toEqual(['connecting', 'no-signal'])

    const stick = setup({
      lives: [() => Promise.reject(new OvdError('LIVE_UNSUPPORTED', 'no', 'Take a screenshot'))]
    })
    stick.controller.start('G070000000000001')
    await flush()
    expect(stick.states.at(-1)).toMatchObject({
      status: 'error',
      error: { code: 'LIVE_UNSUPPORTED' }
    })
  })

  test('stop closes the stream, ends the wait for an ack and goes idle', async () => {
    const stream = fakeLive()
    const s = setup({ lives: [async () => stream.live] })
    s.controller.start('VirtualDevice')
    stream.push(frameOf(0))
    await flush()
    s.controller.stop()
    await flush()
    expect(stream.state.closed).toBe(true)
    expect(s.statuses()).toEqual(['connecting', 'live', 'idle'])
    expect(s.reads()).toBe(0)
  })

  test('close (quit, window gone) closes it at once without a push', async () => {
    const stream = fakeLive()
    const s = setup({ lives: [async () => stream.live] })
    s.controller.start('VirtualDevice')
    stream.push(frameOf(0))
    await flush()
    s.controller.close()
    expect(stream.state.closed).toBe(true)
    await flush()
    expect(s.statuses()).toEqual(['connecting', 'live'])
    expect(s.controller.state()).toEqual({ status: 'idle', target: null })
  })

  test('a stream that opens after a stop is closed', async () => {
    const stream = fakeLive()
    let open = (): void => undefined
    const s = setup({
      lives: [() => new Promise<LiveScreen>((resolve) => (open = () => resolve(stream.live)))]
    })
    s.controller.start('VirtualDevice')
    s.controller.stop()
    open()
    await flush()
    expect(stream.state.closed).toBe(true)
    expect(s.statuses()).toEqual(['connecting', 'idle'])
  })

  describe('refresh and image', () => {
    const shot: ScreenshotResult = {
      target: { id: 'G070000000000001', name: 'Living room stick' },
      backend: 'gwsi-tool-screenshooter',
      path: '/captures/living-room-stick-20261112-021100.png',
      width: 1920,
      height: 1080,
      bytes: 9780,
      takenAt: '2026-11-12T02:11:00.000Z'
    }

    test('refresh takes a screenshot (no clipboard), returns its PNG and pushes the list', async () => {
      const s = setup({ take: async () => shot })
      expect(await s.controller.refresh('G070000000000001')).toEqual({
        ok: true,
        data: { shot, png: Uint8Array.from([0x89, 0x50]) }
      })
      expect(s.captures).toHaveLength(1)
    })

    test('a failed refresh is data, and nothing is pushed', async () => {
      const s = setup({
        take: () => Promise.reject(new OvdError('SCREENSHOT_FAILED', 'no', 'Check the device'))
      })
      expect(await s.controller.refresh('G070000000000001')).toMatchObject({
        ok: false,
        error: { code: 'SCREENSHOT_FAILED' }
      })
      expect(s.captures).toEqual([])
    })

    test('image reads only a PNG inside the captures folder', async () => {
      const root = await mkdtemp(join(tmpdir(), 'ovd-screen-'))
      const dir = join(root, 'captures')
      await mkdir(dir)
      await writeFile(join(dir, 'a.png'), 'png')
      await writeFile(join(root, 'secret.png'), 'no')
      const s = setup({ dir })
      expect(await s.controller.image(join(dir, 'a.png'))).toEqual({
        ok: true,
        data: Uint8Array.from([0x89, 0x50])
      })
      await expect(s.controller.image(join(root, 'secret.png'))).rejects.toThrow(TypeError)
      await expect(s.controller.image(join(dir, '..', 'secret.png'))).rejects.toThrow(TypeError)
      await expect(s.controller.image(42)).rejects.toThrow(TypeError)
      expect(await s.controller.image(join(dir, 'gone.png'))).toMatchObject({
        ok: false,
        error: { code: 'PATH_NOT_FOUND' }
      })
    })
  })
})
