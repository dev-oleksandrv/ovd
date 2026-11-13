import { randomBytes } from 'node:crypto'
import type { ActivityLog } from '../activity/activityLog.js'
import { createLogged, createPreflight } from '../activity/logged.js'
import { parseVdaPull } from '../adapters/parseVdaPull.js'
import type { Devices } from '../devices/devices.js'
import { offline, onlineTarget } from '../devices/onlineTarget.js'
import type { Device } from '../devices/types.js'
import { OvdError } from '../errors/ovdError.js'
import { vdaCmd } from '../sdk/commands.js'
import type { Runner } from '../sdk/runner.js'
import type { SdkLocator } from '../sdk/sdkLocator.js'
import type { Emulator } from '../vvd/emulator.js'
import type { Vvd } from '../vvd/vvd.js'
import { captureBase, capturesDir, listCaptures, type CapturesList } from './captures.js'
import { createClipboard, type ClipboardDeps, type ClipboardTool } from './clipboard.js'
import { pngSize } from './png.js'
import {
  commitFile,
  nodeSaveFs,
  readPart,
  removeQuietly,
  resolveDestination,
  tempFor,
  writePart,
  type Destination,
  type SaveFs
} from './saveFile.js'

export interface ScreenshotDeps {
  runner: Runner
  sdk: SdkLocator
  devices: Devices
  activity: ActivityLog
  emulator: Pick<Emulator, 'screenshot'>
  vvd: Pick<Vvd, 'ensureGrpc'>
  env: Record<string, string | undefined>
  homedir: string
  // Where a relative `--out` resolves; the process's working directory.
  cwd: string
  platform: NodeJS.Platform
  now?: () => Date
  // 8 hex characters for temp names, on the host and the device.
  randomHex?: () => string
  fs?: SaveFs
  clipboardExec?: ClipboardDeps['exec']
  isExecutable?: ClipboardDeps['isExecutable']
}

// The Virtual Device through emulator gRPC `getScreenshot` (ADR 0010), sticks through
// `gwsi-tool-screenshooter` and `vda pull`.
export type ScreenshotBackend = 'grpc' | 'gwsi-tool-screenshooter'

export interface ScreenshotResult {
  target: { id: string; name: string }
  backend: ScreenshotBackend
  // Absolute.
  path: string
  width: number
  height: number
  bytes: number
  takenAt: string
}

export interface ScreenshotOptions {
  device?: string
  // A `.png` file or an existing folder; relative to the core's working directory.
  out?: string
  // Replace an existing `out` file.
  force?: boolean
  // Ctrl+C: rejects with an AbortError (not logged); nothing is saved.
  signal?: AbortSignal
}

export interface Screenshot {
  // `ovd screenshot`: one PNG from the target, saved in the captures folder (or `out`).
  take(opts?: ScreenshotOptions): Promise<ScreenshotResult>
  // The newest captures in the captures folder, newest first.
  captures(opts?: { limit?: number }): Promise<CapturesList>
  // The captures folder (`OVD_CAPTURES`, else `~/ovd/captures`).
  dir(): string
  // `--clipboard`: a host action, not a device action, so it isn't logged.
  copy(path: string): Promise<{ tool: ClipboardTool }>
}

const VVD_VDA_SERIAL = 'emulator-5554'
// A hung screenshooter holds the serial runner, and with it every SDK call, until it is stopped
// (ARCHITECTURE §8: it never finished on the Virtual Device).
const SHOOTER_TIMEOUT_MS = 15_000
const PULL_TIMEOUT_MS = 30_000
const RM_TIMEOUT_MS = 10_000
const CHECK_DEVICE = 'Check the device with ovd devices, then retry'
const DEFAULT_LIMIT = 100

export function screenshotBackend(device: Device): ScreenshotBackend {
  return device.kind === 'vvd' ? 'grpc' : 'gwsi-tool-screenshooter'
}

function abortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

function failed(message: string): OvdError {
  return new OvdError('SCREENSHOT_FAILED', message, CHECK_DEVICE)
}

export function createScreenshot(deps: ScreenshotDeps): Screenshot {
  const logged = createLogged(deps.activity)
  const preflight = createPreflight(deps.activity)
  const now = deps.now ?? (() => new Date())
  const randomHex = deps.randomHex ?? (() => randomBytes(4).toString('hex'))
  const fs = deps.fs ?? nodeSaveFs
  const dir = capturesDir(deps.env, deps.homedir)
  const clipboard = createClipboard({
    platform: deps.platform,
    env: deps.env,
    ...(deps.clipboardExec ? { exec: deps.clipboardExec } : {}),
    ...(deps.isExecutable ? { isExecutable: deps.isExecutable } : {})
  })

  // The device as VDA lists it now; null when that can't be read.
  async function reread(device: Device): Promise<Device | null> {
    try {
      return await deps.devices.get(device.id)
    } catch (error) {
      if (!(error instanceof OvdError)) throw error
      return error.code === 'DEVICE_NOT_FOUND' ? { ...device, status: 'offline' } : null
    }
  }

  // The PNG bytes from the Virtual Device; gRPC found off is turned on once (and logged).
  async function grpcShot(device: Device, signal?: AbortSignal): Promise<Uint8Array> {
    const serial = device.vdaSerial ?? VVD_VDA_SERIAL
    const opts = signal ? { signal } : {}
    try {
      return await deps.emulator.screenshot(serial, opts)
    } catch (error) {
      if (signal?.aborted || !(error instanceof OvdError) || error.details?.off !== true) {
        throw error
      }
      await deps.vvd.ensureGrpc(device, signal)
      return deps.emulator.screenshot(serial, opts)
    }
  }

  // The stick takes the screenshot into a device temp file, which is pulled into `temp` and
  // always removed afterwards (without the signal, so Ctrl+C still cleans up).
  async function stickShot(device: Device, temp: string, signal?: AbortSignal): Promise<void> {
    const { vegaPath } = await deps.sdk.get()
    const serial = device.vdaSerial ?? device.id
    const remote = `/tmp/ovd-screenshot-${randomHex()}.png`
    const withSignal = signal ? { signal } : {}
    try {
      let shot
      try {
        // `stopWhen` never matches: it puts the command in its own process group, so a timeout
        // stops the whole `vega` chain, not only its top process.
        shot = await deps.runner.run({
          ...vdaCmd(vegaPath, ['shell', 'gwsi-tool-screenshooter', remote], serial, withSignal),
          stopWhen: () => false,
          timeoutMs: SHOOTER_TIMEOUT_MS
        })
      } catch (error) {
        if (error instanceof OvdError && error.details?.timedOut === true) {
          throw failed(
            `gwsi-tool-screenshooter on ${device.name} didn’t finish in ${SHOOTER_TIMEOUT_MS / 1000} s`
          )
        }
        throw error
      }
      if (shot.exitCode !== 0) {
        const line = `${shot.stdout}\n${shot.stderr}`.trim().split('\n').at(-1)?.trim() ?? ''
        throw failed(`gwsi-tool-screenshooter on ${device.name} failed${line ? `: ${line}` : ''}`)
      }
      const pull = parseVdaPull(
        await deps.runner.run(
          vdaCmd(vegaPath, ['pull', remote, temp], serial, {
            ...withSignal,
            timeoutMs: PULL_TIMEOUT_MS
          })
        )
      )
      if (!pull.ok) {
        throw failed(`Couldn’t pull the screenshot from ${device.name}: ${pull.message}`)
      }
    } finally {
      await deps.runner
        .run(vdaCmd(vegaPath, ['shell', 'rm', '-f', remote], serial, { timeoutMs: RM_TIMEOUT_MS }))
        .catch(() => undefined)
    }
  }

  async function capture(
    device: Device,
    dest: Destination,
    signal?: AbortSignal
  ): Promise<ScreenshotResult> {
    const backend = screenshotBackend(device)
    const takenAt = now()
    const base = captureBase(device.name, takenAt)
    const temp = await tempFor(dest, base, randomHex())
    try {
      let bytes: Uint8Array
      if (backend === 'grpc') {
        bytes = await grpcShot(device, signal)
        if (signal?.aborted) throw abortError()
        if (!pngSize(bytes)) throw failed(`${device.name} sent a screenshot that isn’t a PNG`)
        await writePart(temp, bytes)
      } else {
        await stickShot(device, temp, signal)
        if (signal?.aborted) throw abortError()
        bytes = (await readPart(temp)) ?? new Uint8Array()
      }
      const size = pngSize(bytes)
      if (!size) throw failed(`${device.name} gave an empty or invalid screenshot`)
      const path = await commitFile(temp, dest, base, fs)
      return {
        target: { id: device.id, name: device.name },
        backend,
        path,
        ...size,
        bytes: bytes.length,
        takenAt: takenAt.toISOString()
      }
    } finally {
      await removeQuietly(temp)
    }
  }

  return {
    async take(opts = {}) {
      const { device, dest } = await preflight('screenshot', async (known) => {
        // The path is checked before any SDK call.
        const destination = await resolveDestination({
          out: opts.out,
          force: opts.force ?? false,
          cwd: deps.cwd,
          capturesDir: dir
        })
        const found = await onlineTarget(deps.devices, opts.device)
        known.target = found.id
        known.args.backend = screenshotBackend(found)
        return { device: found, dest: destination }
      })
      if (opts.signal?.aborted) throw abortError()
      const backend = screenshotBackend(device)
      return logged('screenshot', device.id, { backend }, async () => {
        try {
          return await capture(device, dest, opts.signal)
        } catch (error) {
          if (opts.signal?.aborted) throw abortError()
          // A failure on a device that went away is TARGET_OFFLINE, as for input.
          if (error instanceof OvdError && error.code !== 'TARGET_OFFLINE') {
            const current = await reread(device)
            if (current && current.status !== 'online') throw offline(current)
          }
          throw error
        }
      })
    },

    async captures(opts = {}) {
      return { dir, captures: await listCaptures(dir, opts.limit ?? DEFAULT_LIMIT) }
    },

    dir: () => dir,

    copy: (path) => clipboard.copyPng(path)
  }
}
