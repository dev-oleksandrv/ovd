import { readFile, realpath } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import {
  isOvdError,
  toErrorJson,
  type CapturesList,
  type Device,
  type ErrorJson,
  type LiveScreen,
  type Ovd
} from '@ovd/core'
import type { IpcResult, ScreenFramePush, ScreenRefreshed, ScreenState } from '../preload/api'
import { capturePath, inputText } from './guards'
import { toResult } from './ipcResult'

export interface ScreenController {
  // Starts the live view of `device` (one `screen.live` entry), or returns the state of the one
  // already connecting or live for it.
  start(device: unknown): ScreenState
  // Ends the live view and goes idle (pushed).
  stop(): void
  // The renderer is done with frame `seq`; stale and repeated acks are ignored.
  ack(seq: unknown): void
  // `ovd screenshot --device <id>` for a stick's Refresh, with the PNG to show.
  refresh(device: unknown): Promise<IpcResult<ScreenRefreshed>>
  // The PNG of a capture; TypeError for a path that isn't one.
  image(path: unknown): Promise<IpcResult<Uint8Array>>
  state(): ScreenState
  // Synchronous, for quit and the window going away: the stream's session is destroyed at once.
  close(): void
}

// The device is read this many times, this far apart, after a stream ends while it still lists
// online: VDA can lag behind a `vega virtual-device stop`.
export const REREAD_ATTEMPTS = 3
export const REREAD_MS = 1_000

const IDLE: ScreenState = { status: 'idle', target: null }

function unexpected(error: unknown): ErrorJson {
  return {
    code: 'VVD_GRPC_FAILED',
    message: error instanceof Error ? error.message : String(error),
    hint: 'This is a bug in OVD. Please report it with what you did'
  }
}

function requireSeq(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError('seq must be a non-negative integer')
  }
  return value
}

// Remote & Screen's live view (Stage 4.4): main streams the Virtual Device's screen and sends
// one frame at a time, the next only once the renderer acked the last, so a slow renderer
// holds the emulator back through HTTP/2 flow control instead of queueing frames.
export function createScreenController(deps: {
  screen: Pick<Ovd['screen'], 'live'>
  devices: Pick<Ovd['devices'], 'get'>
  screenshot: Pick<Ovd['screenshot'], 'take' | 'captures' | 'dir'>
  sendFrame: (frame: ScreenFramePush) => void
  sendState: (state: ScreenState) => void
  sendCaptures: (list: CapturesList) => void
  sleep?: (ms: number) => Promise<void>
  readFile?: (path: string) => Promise<Uint8Array>
  realpath?: (path: string) => Promise<string>
}): ScreenController {
  const sleep = deps.sleep ?? ((ms: number) => delay(ms))
  const read = deps.readFile ?? ((path: string) => readFile(path))
  const real = deps.realpath ?? ((path: string) => realpath(path))
  let state: ScreenState = IDLE
  // Bumped by every start and stop: work of an older view is dropped.
  let generation = 0
  let current: { live?: LiveScreen; abort: AbortController } | undefined
  // Main's frame counter, across views.
  let seq = 0
  // The frame sent and not acked yet.
  let awaiting: { seq: number; acked: () => void } | undefined

  const set = (gen: number, next: ScreenState) => {
    if (gen !== generation) return
    state = next
    deps.sendState(state)
  }

  // Ends the current view's stream and any wait for an ack.
  const drop = () => {
    const old = current
    current = undefined
    old?.abort.abort()
    old?.live?.close()
    const wait = awaiting
    awaiting = undefined
    wait?.acked()
  }

  // The device as VDA lists it now; offline when it is gone.
  const reread = async (id: string): Promise<Device['status'] | null> => {
    try {
      return (await deps.devices.get(id)).status
    } catch (error) {
      if (isOvdError(error) && error.code === 'DEVICE_NOT_FOUND') return 'offline'
      return null
    }
  }

  // Whether the device still lists online after a stream ended: read up to 3 times.
  const stillOnline = async (gen: number, id: string): Promise<boolean | undefined> => {
    for (let i = 0; i < REREAD_ATTEMPTS; i++) {
      if (i > 0) await sleep(REREAD_MS)
      if (gen !== generation) return undefined
      const status = await reread(id)
      if (gen !== generation) return undefined
      if (status !== null && status !== 'online') return false
    }
    return true
  }

  // Sends frames one at a time until the stream ends, then decides what the view shows.
  async function pump(gen: number, live: LiveScreen): Promise<ErrorJson | null> {
    for (;;) {
      let frame
      try {
        frame = await live.next()
      } catch (error) {
        return isOvdError(error) ? toErrorJson(error) : unexpected(error)
      }
      if (gen !== generation) return null
      if (frame === null) return null
      const n = ++seq
      await new Promise<void>((resolve) => {
        awaiting = { seq: n, acked: resolve }
        deps.sendFrame({
          seq: n,
          width: frame.width,
          height: frame.height,
          timestampUs: frame.timestampUs,
          pixels: frame.pixels
        })
      })
      if (gen !== generation) return null
    }
  }

  // One view: opens the stream (logged unless `quiet`), pumps it, and on its end reopens it
  // once while the device still lists online.
  async function run(gen: number, id: string): Promise<void> {
    let reopened = false
    let quiet = false
    for (;;) {
      const abort = new AbortController()
      current = { abort }
      let error: ErrorJson | null = null
      try {
        const live = await deps.screen.live({ device: id, signal: abort.signal, quiet })
        if (gen !== generation) {
          live.close()
          return
        }
        current.live = live
        set(gen, { status: 'live', target: live.target })
        // A stream that delivered frames again gets its own reopen when it ends.
        reopened = false
        error = await pump(gen, live)
        live.close()
      } catch (thrown) {
        if (gen !== generation) return
        if (thrown instanceof Error && thrown.name === 'AbortError') return
        error = isOvdError(thrown) ? toErrorJson(thrown) : unexpected(thrown)
      }
      if (gen !== generation) return
      const target = state.target ?? { id, name: id }
      if (error && error.code === 'TARGET_OFFLINE') {
        set(gen, { status: 'no-signal', target })
        return
      }
      if (error && error.code !== 'VVD_GRPC_FAILED') {
        set(gen, { status: 'error', target, error })
        return
      }
      const online = await stillOnline(gen, id)
      if (online === undefined) return
      if (!online) {
        set(gen, { status: 'no-signal', target })
        return
      }
      if (reopened) {
        set(gen, {
          status: 'error',
          target,
          error: error ?? {
            code: 'VVD_GRPC_FAILED',
            message: 'The Virtual Device’s screen stream keeps ending',
            hint: 'Restart the Virtual Device with ovd vvd stop, then ovd vvd start'
          }
        })
        return
      }
      // Still online: the Virtual Device restarted, or the stream dropped. Not a new view.
      reopened = true
      quiet = true
      set(gen, { status: 'connecting', target })
    }
  }

  return {
    start(value) {
      const id = inputText(value, 'device')
      if (state.target?.id === id && (state.status === 'connecting' || state.status === 'live')) {
        return state
      }
      drop()
      const gen = ++generation
      set(gen, {
        status: 'connecting',
        target: { id, name: state.target?.id === id ? state.target.name : id }
      })
      void run(gen, id)
      return state
    },

    stop() {
      generation++
      drop()
      state = IDLE
      deps.sendState(state)
    },

    ack(value) {
      const n = requireSeq(value)
      if (!awaiting || awaiting.seq !== n) return
      const wait = awaiting
      awaiting = undefined
      wait.acked()
    },

    async refresh(value) {
      const device = inputText(value, 'device')
      const result = await toResult(async () => {
        const shot = await deps.screenshot.take({ device })
        return { shot, png: new Uint8Array(await read(shot.path)) }
      })
      if (result.ok) {
        const list = await deps.screenshot.captures().catch(() => null)
        if (list) deps.sendCaptures(list)
      }
      return result
    },

    async image(value) {
      let path: string
      try {
        path = await capturePath(value, deps.screenshot.dir(), real)
      } catch (error) {
        // An invalid payload stays a thrown error; a capture removed meanwhile is data.
        if (error instanceof TypeError) throw error
        return gone()
      }
      try {
        return { ok: true, data: new Uint8Array(await read(path)) }
      } catch {
        return gone()
      }
    },

    state: () => state,

    close() {
      generation++
      drop()
      state = IDLE
    }
  }
}

function gone(): IpcResult<Uint8Array> {
  return {
    ok: false,
    error: {
      code: 'PATH_NOT_FOUND',
      message: 'That screenshot is gone',
      hint: 'Take another one with Refresh'
    }
  }
}
