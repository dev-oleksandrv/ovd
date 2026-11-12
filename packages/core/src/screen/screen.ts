import type { ActivityLog } from '../activity/activityLog.js'
import { createLogged, createPreflight } from '../activity/logged.js'
import type { Devices } from '../devices/devices.js'
import { onlineTarget } from '../devices/onlineTarget.js'
import type { Device } from '../devices/types.js'
import { OvdError } from '../errors/ovdError.js'
import type { Emulator } from '../vvd/emulator.js'
import type { FrameStream } from '../vvd/emulatorGrpc.js'
import type { ImageFormat, ScreenFrame } from '../vvd/grpcWire.js'
import type { Vvd } from '../vvd/vvd.js'

export interface ScreenDeps {
  devices: Devices
  activity: ActivityLog
  emulator: Pick<Emulator, 'streamScreenshot'>
  vvd: Pick<Vvd, 'ensureGrpc'>
}

// Only the Virtual Device streams its screen (emulator gRPC `streamScreenshot`, ADR 0010); a
// stick has screenshots only.
export type ScreenBackend = 'grpc'

export interface LiveScreen {
  target: { id: string; name: string }
  backend: ScreenBackend
  // The next frame, the first one at once; null once the stream ended (the Virtual Device
  // stopped, `close`, an abort). Rejects with `VVD_GRPC_FAILED` when the stream failed. Until
  // a frame is taken the stream holds the emulator back (HTTP/2 flow control).
  next(): Promise<ScreenFrame | null>
  close(): void
}

export interface LiveOptions {
  device?: string
  // Closes the stream; `live` itself then rejects with an AbortError (not logged).
  signal?: AbortSignal
  // A reopen of the same view (its stream ended while the device stayed online): not logged
  // again, as it isn't a new view.
  quiet?: boolean
}

export interface Screen {
  // The target's live screen, resolved at its first frame and logged once as `screen.live`.
  // A stick is `LIVE_UNSUPPORTED`; gRPC found off is turned on once (`vvd.grpc.enable`).
  live(opts?: LiveOptions): Promise<LiveScreen>
}

// RGBA8888 at 960x540 took 5.5 ms a frame on the Virtual Device, where PNG at that size took
// 120 ms (ARCHITECTURE §8): raw pixels the renderer draws without decoding.
export const LIVE_FORMAT: ImageFormat = { format: 'rgba8888', width: 960, height: 540 }

const VVD_VDA_SERIAL = 'emulator-5554'

function abortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

function liveUnsupported(device: Device): OvdError {
  return new OvdError(
    'LIVE_UNSUPPORTED',
    `${device.name} can’t stream its screen`,
    'Take a screenshot with ovd screenshot'
  )
}

export function createScreen(deps: ScreenDeps): Screen {
  const logged = createLogged(deps.activity)
  const preflight = createPreflight(deps.activity)

  // The stream; gRPC found off is turned on once, as for a screenshot.
  async function open(device: Device, signal?: AbortSignal): Promise<FrameStream> {
    const serial = device.vdaSerial ?? VVD_VDA_SERIAL
    const opts = signal ? { signal } : {}
    try {
      return await deps.emulator.streamScreenshot(serial, LIVE_FORMAT, opts)
    } catch (error) {
      if (signal?.aborted || !(error instanceof OvdError) || error.details?.off !== true) {
        throw error
      }
      await deps.vvd.ensureGrpc(device, signal)
      return deps.emulator.streamScreenshot(serial, LIVE_FORMAT, opts)
    }
  }

  // Resolves at the first frame, which the view's first `next` returns.
  async function start(device: Device, signal?: AbortSignal): Promise<LiveScreen> {
    const stream = await open(device, signal)
    let first: ScreenFrame | null
    try {
      first = await stream.next()
    } catch (error) {
      stream.close()
      throw error
    }
    if (first === null) {
      stream.close()
      if (signal?.aborted) throw abortError()
      throw new OvdError(
        'VVD_GRPC_FAILED',
        'Emulator gRPC ended the screen stream before its first frame',
        'Check the Virtual Device with ovd devices, then retry'
      )
    }
    let held: ScreenFrame | undefined = first
    return {
      target: { id: device.id, name: device.name },
      backend: 'grpc',
      next() {
        const frame = held
        held = undefined
        return frame ? Promise.resolve(frame) : stream.next()
      },
      close() {
        held = undefined
        stream.close()
      }
    }
  }

  async function target(override: string | undefined, known?: { target: string | null }) {
    const device = await onlineTarget(deps.devices, override)
    if (known) known.target = device.id
    if (device.kind !== 'vvd') throw liveUnsupported(device)
    return device
  }

  return {
    async live(opts = {}) {
      if (opts.quiet) return start(await target(opts.device), opts.signal)
      const device = await preflight('screen.live', (known) => target(opts.device, known))
      return logged('screen.live', device.id, { backend: 'grpc' }, () => start(device, opts.signal))
    }
  }
}
