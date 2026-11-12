import { setTimeout as delay } from 'node:timers/promises'
import type { ActivityLog } from '../activity/activityLog.js'
import { createLogged, createPreflight } from '../activity/logged.js'
import type { Devices } from '../devices/devices.js'
import { offline, onlineTarget } from '../devices/onlineTarget.js'
import type { Device } from '../devices/types.js'
import { OvdError, type ErrorCode } from '../errors/ovdError.js'
import type { Pairing } from '../pairing/pairing.js'
import { vdaCmd } from '../sdk/commands.js'
import type { Runner } from '../sdk/runner.js'
import type { SdkLocator } from '../sdk/sdkLocator.js'

export interface RebootDeps {
  runner: Runner
  sdk: SdkLocator
  devices: Devices
  pairing: Pick<Pairing, 'reconnect'>
  activity: ActivityLog
  env: Record<string, string | undefined>
  // Injected so tests wait without real timers.
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  // Epoch ms.
  now?: () => number
}

// What the reboot is doing, for the surfaces' progress lines: `rebooting` before `vda reboot`,
// then the wait (`settling`: back online, info answering on every poll).
export type RebootProgress = 'rebooting' | 'waiting' | 'reconnecting' | 'settling'

export interface RebootOptions {
  device?: string
  // How long to wait for the device to come back, the settle included (default 120 s).
  timeoutMs?: number
  // Ctrl+C: rejects with an AbortError. Once `vda reboot` was sent the device still reboots,
  // so that attempt is logged (ok, `wait: cancelled`).
  signal?: AbortSignal
  onProgress?: (progress: RebootProgress, target: { id: string; name: string }) => void
}

export interface RebootResult {
  target: { id: string; name: string }
  // From `vda reboot` to back online, settle included, whole seconds.
  seconds: number
  // OVD reconnected a Wi‑Fi stick VDA had lost track of (`vda connect` answered connected).
  reconnected: boolean
}

export interface Reboot {
  // `ovd reboot`: `vda reboot`, then waits until the device has gone away and is back online,
  // with `vega device info` answering on every poll for the settle time.
  reboot(opts?: RebootOptions): Promise<RebootResult>
}

export const DEFAULT_REBOOT_TIMEOUT_MS = 120_000
const SEND_TIMEOUT_MS = 15_000
const POLL_MS = 1_000
// The Virtual Device left the list about 1 s after `vda reboot` (ARCHITECTURE §8); a device
// still answering after this long didn't restart.
const AWAY_LIMIT_MS = 30_000
// Info answered 6.4–7.7 s after the reboot, and VDA dropped and re-listed the Virtual Device
// once per boot, up to 4.4 s after info first answered (ARCHITECTURE §8).
const SETTLE_MS = 8_000
// A Wi‑Fi stick VDA no longer lists gets one `vda connect` this often.
const RECONNECT_EVERY_MS = 10_000
// Failed polls in a row (VDA busy, a command that timed out) before the wait gives up.
const MAX_FAILED_POLLS = 10
// Polls for a device VDA lost right before `vda reboot` to be listed again.
const RELIST_POLLS = 5
const TRANSIENT: readonly ErrorCode[] = ['VDA_UNAVAILABLE', 'COMMAND_FAILED', 'UNEXPECTED_OUTPUT']

function abortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

// `OVD_REBOOT_SETTLE_MS`: a testing hook (as `OVD_EMULATOR_*` are), a non-negative integer.
function settleMs(env: Record<string, string | undefined>): number {
  const raw = env.OVD_REBOOT_SETTLE_MS
  return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : SETTLE_MS
}

type Observation = { state: 'away' | 'up'; unlisted: boolean } | { failed: OvdError }

export function createReboot(deps: RebootDeps): Reboot {
  const logged = createLogged(deps.activity)
  const preflight = createPreflight(deps.activity)
  const sleep = deps.sleep ?? ((ms, signal) => delay(ms, undefined, signal ? { signal } : {}))
  const now = deps.now ?? (() => Date.now())

  // One poll; `failed` when it failed in a way the next poll may not.
  async function observe(id: string): Promise<Observation> {
    deps.devices.invalidate(id)
    try {
      const device = await deps.devices.get(id)
      const up = device.status === 'online' && device.info !== undefined
      return { state: up ? 'up' : 'away', unlisted: device.vdaSerial === undefined }
    } catch (error) {
      if (!(error instanceof OvdError)) throw error
      // An unsaved Wi‑Fi stick VDA no longer lists is unknown to OVD for as long.
      if (error.code === 'DEVICE_NOT_FOUND') return { state: 'away', unlisted: true }
      if (TRANSIENT.includes(error.code)) return { failed: error }
      throw error
    }
  }

  // One `vda reboot`; false when VDA answered that it doesn't know the serial.
  async function sendOnce(device: Device, signal?: AbortSignal): Promise<boolean> {
    const { vegaPath } = await deps.sdk.get()
    const run = await deps.runner.run(
      vdaCmd(vegaPath, ['reboot'], device.vdaSerial ?? device.id, {
        timeoutMs: SEND_TIMEOUT_MS,
        ...(signal ? { signal } : {})
      })
    )
    if (run.exitCode === 0) return true
    // fixtures/0.24/vda-reboot/device-not-found.stderr.txt: VDA lost it since the preflight.
    if (/not found/.test(run.stderr)) return false
    const line = `${run.stdout}\n${run.stderr}`.trim().split('\n').at(-1)?.trim() ?? ''
    throw new OvdError(
      'REBOOT_FAILED',
      `Couldn’t reboot ${device.name}${line ? `: ${line}` : ''}`,
      'Check the device with ovd devices, then retry',
      { exitCode: run.exitCode, stderr: run.stderr.slice(-500) }
    )
  }

  // The device listed online again, read fresh up to RELIST_POLLS times; null if it isn't.
  async function relisted(id: string, signal?: AbortSignal): Promise<Device | null> {
    for (let poll = 0; poll < RELIST_POLLS; poll++) {
      if (signal?.aborted) throw abortError()
      await sleep(POLL_MS, signal)
      if (signal?.aborted) throw abortError()
      deps.devices.invalidate(id)
      try {
        const device = await deps.devices.get(id)
        if (device.status === 'online') return device
      } catch (error) {
        if (signal?.aborted) throw abortError()
        if (!(error instanceof OvdError)) throw error
        if (error.code !== 'DEVICE_NOT_FOUND' && !TRANSIENT.includes(error.code)) throw error
      }
    }
    return null
  }

  async function send(device: Device, signal?: AbortSignal): Promise<void> {
    if (await sendOnce(device, signal)) return
    // VDA drops the Virtual Device for a few seconds right after a start (ARCHITECTURE §8):
    // once it lists the device again (maybe under a new transport ID), one more try.
    const back = await relisted(device.id, signal)
    if (back && (await sendOnce(back, signal))) return
    throw offline({ ...device, status: 'offline' })
  }

  async function wait(
    device: Device,
    started: number,
    timeoutMs: number,
    opts: RebootOptions
  ): Promise<boolean> {
    const settle = settleMs(deps.env)
    const deadline = started + timeoutMs
    const wifi = device.connection === 'wifi'
    let progress: RebootProgress | undefined
    const report = (next: RebootProgress) => {
      if (progress === next) return
      progress = next
      opts.onProgress?.(next, { id: device.id, name: device.name })
    }
    let sawAway = false
    let upSince: number | null = null
    let unlistedSince: number | null = null
    let lastReconnect: number | null = null
    let reconnected = false
    let failed = 0
    // Time covered by answered polls before the device was seen away.
    let answeredMs = 0
    report('waiting')
    for (;;) {
      if (opts.signal?.aborted) throw abortError()
      if (now() >= deadline) throw timedOut(device, timeoutMs)
      await sleep(POLL_MS, opts.signal)
      if (opts.signal?.aborted) throw abortError()
      let seen: Observation
      try {
        seen = await observe(device.id)
      } catch (error) {
        if (opts.signal?.aborted) throw abortError()
        throw error
      }
      if ('failed' in seen) {
        failed++
        if (failed >= MAX_FAILED_POLLS) throw seen.failed
        continue
      }
      failed = 0
      const at = now()
      if (seen.state === 'away') {
        sawAway = true
        upSince = null
        report('waiting')
        unlistedSince = seen.unlisted ? (unlistedSince ?? at) : null
        if (
          wifi &&
          unlistedSince !== null &&
          at - unlistedSince >= RECONNECT_EVERY_MS &&
          (lastReconnect === null || at - lastReconnect >= RECONNECT_EVERY_MS)
        ) {
          report('reconnecting')
          lastReconnect = at
          if (await deps.pairing.reconnect(device.id)) reconnected = true
          report('waiting')
        }
        continue
      }
      unlistedSince = null
      if (!sawAway) {
        // Only answered polls count here: a failed poll may have missed the device away.
        answeredMs += POLL_MS
        if (answeredMs >= AWAY_LIMIT_MS) {
          throw new OvdError(
            'REBOOT_FAILED',
            `${device.name} didn’t restart`,
            'It may have restarted faster than OVD could see; check with ovd devices'
          )
        }
        continue
      }
      upSince ??= at
      report('settling')
      if (at - upSince >= settle) return reconnected
    }
  }

  return {
    async reboot(opts = {}) {
      const timeoutMs = opts.timeoutMs ?? DEFAULT_REBOOT_TIMEOUT_MS
      const args = { timeout: String(Math.round(timeoutMs / 1000)) }
      const device = await preflight('reboot', async (known) => {
        known.args = { ...args }
        const found = await onlineTarget(deps.devices, opts.device)
        known.target = found.id
        return found
      })
      if (opts.signal?.aborted) throw abortError()
      return logged('reboot', device.id, args, async () => {
        opts.onProgress?.('rebooting', { id: device.id, name: device.name })
        await send(device, opts.signal)
        const started = now()
        let reconnected: boolean
        try {
          reconnected = await wait(device, started, timeoutMs, opts)
        } catch (error) {
          if (!opts.signal?.aborted) throw error
          // The reboot was sent and goes on without OVD: that attempt is logged.
          await deps.activity.append({
            action: 'reboot',
            target: device.id,
            args: { ...args, wait: 'cancelled' },
            result: 'ok'
          })
          throw abortError()
        }
        return {
          target: { id: device.id, name: device.name },
          seconds: Math.round((now() - started) / 1000),
          reconnected
        }
      })
    }
  }
}

function timedOut(device: Device, timeoutMs: number): OvdError {
  return new OvdError(
    'REBOOT_TIMEOUT',
    `${device.name} didn’t come back within ${Math.round(timeoutMs / 1000)} s`,
    device.kind === 'vvd'
      ? 'Restart it with ovd vvd stop, then ovd vvd start'
      : 'Check the stick is on and connected, then check with ovd devices'
  )
}
