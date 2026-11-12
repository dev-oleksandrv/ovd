import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  createActivityLog,
  createScreen,
  LIVE_FORMAT,
  OvdError,
  type ActivityEntry,
  type Device,
  type Devices,
  type FrameStream,
  type ImageFormat,
  type ScreenFrame
} from '../../src/index.js'
import { decodeImageFrame } from '../../src/vvd/grpcWire.js'
import { recordedStream } from '../support/fakeGrpcStream.js'

const FRAMES: ScreenFrame[] = recordedStream().messages.map(decodeImageFrame)

const vvd: Device = {
  id: 'VirtualDevice',
  vdaSerial: 'emulator-5554',
  serial: 'VirtualDevice',
  name: 'Vega Virtual Device',
  kind: 'vvd',
  connection: 'local',
  status: 'online',
  isTarget: true,
  saved: false
}

const stick: Device = {
  id: 'G070000000000001',
  vdaSerial: 'G070000000000001',
  serial: 'G070000000000001',
  name: 'Living room stick',
  kind: 'stick',
  connection: 'usb',
  status: 'online',
  isTarget: true,
  saved: false
}

let home: string

beforeEach(async () => {
  home = join(await mkdtemp(join(tmpdir(), 'ovd-screen-')), 'ovd')
})

// A stream that yields `frames`, then `end` (null, or the error it rejects with).
function fakeStream(frames: ScreenFrame[], end: OvdError | null = null) {
  const queue = [...frames]
  const state = { closed: false }
  const stream: FrameStream = {
    async next() {
      if (state.closed) return null
      const frame = queue.shift()
      if (frame) return frame
      if (end) throw end
      return null
    },
    close: () => void (state.closed = true)
  }
  return { stream, state }
}

type Open = (signal?: AbortSignal) => Promise<FrameStream>

const off = () =>
  new OvdError('VVD_GRPC_FAILED', 'Emulator gRPC is off', 'Turn it on with ovd vvd start', {
    off: true
  })

function setup(opts: { target?: Device | null; opens?: Open[] } = {}) {
  const target = opts.target === undefined ? vvd : opts.target
  const missing = () => Promise.reject(new Error('unexpected'))
  const devices: Devices = {
    list: missing,
    currentTarget: async () => (target ? { device: target, source: 'remembered' } : null),
    get: missing,
    rename: missing,
    setTarget: missing,
    invalidate: () => undefined
  }
  const opens = opts.opens ?? [async () => fakeStream(FRAMES).stream]
  const calls: { serial: string; format: ImageFormat }[] = []
  const ensured: Device[] = []
  const screen = createScreen({
    devices,
    activity: createActivityLog({ home, surface: 'desktop' }),
    emulator: {
      async streamScreenshot(serial, format, streamOpts) {
        calls.push({ serial, format })
        const open = opens[Math.min(calls.length, opens.length) - 1]
        if (!open) throw new Error('no stream')
        return open(streamOpts?.signal)
      }
    },
    vvd: {
      async ensureGrpc(device) {
        ensured.push(device)
        return { port: 8554 }
      }
    }
  })
  return { screen, calls, ensured }
}

async function activity(): Promise<Omit<ActivityEntry, 'time' | 'surface'>[]> {
  const text = await readFile(join(home, 'activity.jsonl'), 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const entry: Partial<ActivityEntry> = JSON.parse(line) as ActivityEntry
      delete entry.time
      delete entry.surface
      return entry as Omit<ActivityEntry, 'time' | 'surface'>
    })
}

describe('Screen.live', () => {
  test('streams RGBA8888 at 960x540 from the Virtual Device, logged once at the first frame', async () => {
    const { screen, calls } = setup()
    const live = await screen.live()
    expect(live).toMatchObject({
      target: { id: 'VirtualDevice', name: 'Vega Virtual Device' },
      backend: 'grpc'
    })
    expect(calls).toEqual([{ serial: 'emulator-5554', format: LIVE_FORMAT }])
    expect(LIVE_FORMAT).toEqual({ format: 'rgba8888', width: 960, height: 540 })
    expect(await activity()).toEqual([
      { action: 'screen.live', target: 'VirtualDevice', args: { backend: 'grpc' }, result: 'ok' }
    ])
    // The first frame, then the rest, then the end.
    expect((await live.next())?.seq).toBe(0)
    expect((await live.next())?.seq).toBe(1)
    expect((await live.next())?.seq).toBe(2)
    expect(await live.next()).toBeNull()
    expect(await activity()).toHaveLength(1)
  })

  test('a stick is LIVE_UNSUPPORTED, logged, and nothing is streamed', async () => {
    const { screen, calls } = setup({ target: stick })
    await expect(screen.live()).rejects.toMatchObject({
      code: 'LIVE_UNSUPPORTED',
      message: 'Living room stick can’t stream its screen',
      hint: 'Take a screenshot with ovd screenshot'
    })
    expect(calls).toEqual([])
    expect(await activity()).toEqual([
      {
        action: 'screen.live',
        target: 'G070000000000001',
        args: {},
        result: 'error',
        errorCode: 'LIVE_UNSUPPORTED'
      }
    ])
  })

  test('no target is NO_TARGET, logged without a target', async () => {
    const { screen } = setup({ target: null })
    await expect(screen.live()).rejects.toMatchObject({ code: 'NO_TARGET' })
    expect(await activity()).toEqual([
      { action: 'screen.live', target: null, args: {}, result: 'error', errorCode: 'NO_TARGET' }
    ])
  })

  test('gRPC off: turned on once, then the stream opens again', async () => {
    const { screen, calls, ensured } = setup({
      opens: [() => Promise.reject(off()), async () => fakeStream(FRAMES).stream]
    })
    const live = await screen.live()
    expect((await live.next())?.seq).toBe(0)
    expect(calls).toHaveLength(2)
    expect(ensured.map((d) => d.id)).toEqual(['VirtualDevice'])
  })

  test('gRPC still off after the enable is the error, logged', async () => {
    const { screen, ensured } = setup({ opens: [() => Promise.reject(off())] })
    await expect(screen.live()).rejects.toMatchObject({ code: 'VVD_GRPC_FAILED' })
    expect(ensured).toHaveLength(1)
    expect(await activity()).toEqual([
      {
        action: 'screen.live',
        target: 'VirtualDevice',
        args: { backend: 'grpc' },
        result: 'error',
        errorCode: 'VVD_GRPC_FAILED'
      }
    ])
  })

  test('a stream that fails before its first frame is logged as an error and closed', async () => {
    const failed = fakeStream(
      [],
      new OvdError('VVD_GRPC_FAILED', 'Emulator gRPC sent no screen frame in 10 s', 'h')
    )
    const { screen } = setup({ opens: [async () => failed.stream] })
    await expect(screen.live()).rejects.toMatchObject({
      message: 'Emulator gRPC sent no screen frame in 10 s'
    })
    expect(failed.state.closed).toBe(true)
    expect((await activity())[0]).toMatchObject({ result: 'error', errorCode: 'VVD_GRPC_FAILED' })
  })

  test('a stream that ends before its first frame is VVD_GRPC_FAILED', async () => {
    const { screen } = setup({ opens: [async () => fakeStream([]).stream] })
    await expect(screen.live()).rejects.toMatchObject({
      code: 'VVD_GRPC_FAILED',
      message: 'Emulator gRPC ended the screen stream before its first frame'
    })
  })

  test('an abort before the first frame rejects with an AbortError, not logged', async () => {
    const controller = new AbortController()
    const { screen } = setup({
      opens: [
        async (signal) => {
          const held: FrameStream = {
            // As the real stream does: an aborted signal ends it.
            next: () =>
              new Promise((resolve) => {
                if (signal?.aborted) resolve(null)
                signal?.addEventListener('abort', () => resolve(null))
              }),
            close: () => undefined
          }
          return held
        }
      ]
    })
    const live = screen.live({ signal: controller.signal })
    controller.abort()
    await expect(live).rejects.toMatchObject({ name: 'AbortError' })
    expect(await activity()).toEqual([])
  })

  test('quiet: a reopen of the same view writes no entry', async () => {
    const { screen } = setup()
    const live = await screen.live({ quiet: true })
    expect((await live.next())?.seq).toBe(0)
    expect(await activity()).toEqual([])
  })

  test('close ends the stream: the held first frame is dropped', async () => {
    const opened = fakeStream(FRAMES)
    const { screen } = setup({ opens: [async () => opened.stream] })
    const live = await screen.live()
    live.close()
    expect(opened.state.closed).toBe(true)
    expect(await live.next()).toBeNull()
  })
})
