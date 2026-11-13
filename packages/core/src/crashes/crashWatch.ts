import type { ActivityLog } from '../activity/activityLog.js'
import type { Devices } from '../devices/devices.js'
import { OvdError } from '../errors/ovdError.js'
import type { CrashReader } from './crashList.js'
import type { CrashWatch, CrashWatchOptions } from './types.js'

export const CRASH_POLL_MS = 5_000

export interface CrashWatchDeps {
  reader: CrashReader
  devices: Devices
  activity: ActivityLog
}

// Polls the target's vault listing (one `vault --ls` per poll, through the serial runner) and
// reports each report that appeared after the first read of that device. The next poll is
// scheduled after the previous one finished, so slow SDK calls never pile up.
//
// The first read of a device by this process (a listing or a watch) is a silent baseline, kept in
// the reader with the set of announced reports. While the target is away the watcher keeps
// polling silently; `onAway` and `onBack` mark the gap, and reports that appeared meanwhile are
// announced once the target is back. The dedupe key is device + vault index (F9).
export function createCrashWatch(deps: CrashWatchDeps, opts: CrashWatchOptions): CrashWatch {
  const intervalMs = opts.intervalMs ?? CRASH_POLL_MS
  let running = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let away: { announced: boolean } | undefined
  let present = false
  let lastError: string | undefined

  function fail(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error))
    const key = `${error instanceof OvdError ? error.code : err.name}|${err.message}`
    if (key === lastError) return
    lastError = key
    opts.onError?.(err)
  }

  function leave(device: { id: string; name: string } | undefined): void {
    if (away === undefined) {
      away = { announced: present }
      if (present) opts.onAway?.(device)
    }
  }

  async function poll(): Promise<void> {
    let resolved
    try {
      resolved = await deps.devices.currentTarget(opts.device)
      if (!resolved) {
        throw new OvdError(
          'NO_TARGET',
          'No target device',
          'Set one with ovd target set <id>, or pass --device <id>'
        )
      }
    } catch (error) {
      if (error instanceof OvdError && error.code === 'DEVICE_NOT_FOUND') {
        leave(undefined)
        return
      }
      fail(error)
      return
    }
    const { device } = resolved
    const who = { id: device.id, name: device.name }
    if (device.status !== 'online') {
      leave(who)
      return
    }
    try {
      const scanned = await deps.reader.scan(device)
      if (!running) return
      if (away !== undefined) {
        const emit = away.announced
        away = undefined
        if (emit) opts.onBack?.(who)
      }
      present = true
      lastError = undefined
      // Oldest first, so a burst reads in the order it happened.
      for (const entry of [...scanned.entries].reverse()) {
        // The baseline and the announced set belong to the reader (per device, per process), so
        // a watcher started later neither repeats an announcement nor loses one.
        if (scanned.isAnnounced(entry) || !scanned.isNew(entry)) continue
        // Marked only once announced: a read that fails is retried at the next poll.
        const crash = await deps.reader.crashOf(scanned, entry)
        if (!running) return
        // A launch may have reported it while the header was read.
        if (scanned.isAnnounced(entry) || !scanned.isNew(entry)) continue
        scanned.markAnnounced(entry)
        await record(who.id, crash)
        if (!running) return
        opts.onNew(crash, who)
      }
    } catch (error) {
      if (error instanceof OvdError && error.code === 'TARGET_OFFLINE') {
        leave(who)
        return
      }
      fail(error)
    }
  }

  // Validated fields only (F11): never stack text, `Source`, `BootId` or log lines. A failed
  // append doesn't stop the toast.
  async function record(
    target: string,
    crash: { package: string; id: number; pid: number; signal: number; time: string }
  ): Promise<void> {
    try {
      await deps.activity.append({
        action: 'crash.detected',
        target,
        args: {
          package: crash.package,
          index: crash.id,
          pid: crash.pid,
          signal: crash.signal,
          epoch: Math.floor(Date.parse(crash.time) / 1000)
        },
        result: 'ok'
      })
    } catch {
      // The activity log is a record, not a gate.
    }
  }

  async function tick(): Promise<void> {
    await poll()
    if (running) timer = setTimeout(() => void tick(), intervalMs)
  }
  void tick()

  return {
    stop() {
      running = false
      clearTimeout(timer)
    }
  }
}
