import { parseAcr } from '../adapters/parseAcr.js'
import { parseLogCapture, type LogCapture } from '../adapters/parseLogCapture.js'
import { parseTombstones, signalName, type Tombstone } from '../adapters/parseTombstones.js'
import { parseVlcmCrashHistory, type CrashEntry } from '../adapters/parseVlcmCrashHistory.js'
import { parseVlcmList, type VlcmEntry } from '../adapters/parseVlcmList.js'
import type { VpmPackage } from '../adapters/parseVpmInfo.js'
import { stripControl } from '../adapters/stripControl.js'
import type { Device } from '../devices/types.js'
import type { AppActionsContext } from './appActions.js'
import { assertAppId, type AppId } from './appId.js'
import {
  acrScript,
  captureStartScript,
  captureStopScript,
  CAPTURE_TAIL_LINES,
  deviceScript
} from './launchScripts.js'

// A crash right after launch, as far as the device tells it. Everything but `pid` and `time`
// is best effort: the crash report may be refused or not enrolled yet, the capture may not run.
export interface LaunchCrash {
  pid: number
  // ISO time of the crash, from the crash history's `LCM_KILLTIME`.
  time: string
  // `SIGABRT`…, from the crash report, else from its file name.
  signal?: string
  // `JavaScript`…, from the crash report.
  language?: string
  // The JS error line (`Error: …`).
  message?: string
  // The JS stack frames.
  stack: string[]
  // The captured log lines about the app and the crash, oldest first.
  logs: string[]
}

// `launch-app` reports success even when the app crashes right after (ADR 0012), so every
// launch checks the running component and the crash history before it returns.
export type LaunchVerification =
  | { verified: true; pid: number }
  | { verified: false; reason: 'crashed'; crash: LaunchCrash }
  | { verified: false; reason: 'not-running' }

// `launch-app` once returned 87 s after the app was up, waiting on the SDK's telemetry step
// (ARCHITECTURE §8).
export const LAUNCH_TIMEOUT_MS = 180_000
// How long a launched app has to stay up. The recorded crashes came about 1 s after `launch-app`
// returned (fixtures/0.24/vlcm-list/app-ready.txt, vlcm-crash-history/stick-one.txt); a real
// app may crash later, so the window is wider. To be confirmed by the maintainer.
export const SETTLE_MS = 5_000
// One `vlcm list --app-id` per second: right after `launch-app` a stick lists the app `IDLE`
// with pid 0, `READY` with a pid 0.6 s later (fixtures/0.24/vlcm-list/app-idle.txt).
export const POLL_MS = 1_000
// One more crash-history read when the app neither runs nor crashed yet.
export const RECHECK_MS = 1_000
// A crash report is enrolled in the vault about 0.6 s after the crash
// (fixtures/0.24/loggingctl-vault-ls/stick-tombstones.json).
export const TOMBSTONE_ATTEMPTS = 3
export const TOMBSTONE_RETRY_MS = 500
export const MAX_LOG_LINES = CAPTURE_TAIL_LINES
// The capture's own `timeout`: the launch timeout, the settle window, then the start and the
// reads around them, so a capture OVD can't stop still ends.
export const CAPTURE_SECONDS = Math.ceil((LAUNCH_TIMEOUT_MS + SETTLE_MS) / 1000) + 15

export type VerifiedLaunch = (
  device: Device,
  pkg: VpmPackage,
  component: AppId,
  launch: () => Promise<void>,
  onVerifying?: () => void
) => Promise<LaunchVerification>

export function createLaunchVerifier(
  ctx: AppActionsContext,
  sleep: (ms: number) => Promise<void>
): VerifiedLaunch {
  async function crashHistory(device: Device): Promise<CrashEntry[]> {
    return parseVlcmCrashHistory(
      (await ctx.shell(device, ['vlcm', 'crash-history'], 'the crash history')).stdout
    )
  }

  // Enrichment: a capture that doesn't start never stops the launch.
  async function startCapture(device: Device): Promise<LogCapture | undefined> {
    try {
      const run = await ctx.deviceShell(device, [deviceScript(captureStartScript(CAPTURE_SECONDS))])
      return run.exitCode === 0 ? parseLogCapture(run.stdout) : undefined
    } catch {
      return undefined
    }
  }

  async function stopCapture(
    device: Device,
    capture: LogCapture,
    packageId: AppId,
    crashPid: number
  ): Promise<string[]> {
    try {
      const run = await ctx.deviceShell(device, [
        deviceScript(captureStopScript(capture, packageId, crashPid))
      ])
      // Apps write these lines and the surfaces print them, so no escape sequence gets through.
      return run.stdout
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(stripControl)
        .filter((l) => l.trim() !== '')
        .slice(-MAX_LOG_LINES)
    } catch {
      return []
    }
  }

  async function tombstoneOf(
    device: Device,
    pkg: VpmPackage,
    entry: CrashEntry
  ): Promise<Tombstone | undefined> {
    const underscored = pkg.id.replaceAll('.', '_')
    for (let attempt = 1; attempt <= TOMBSTONE_ATTEMPTS; attempt++) {
      const run = await ctx.deviceShell(device, [
        'loggingctl',
        'vault',
        '--ls',
        'SYSTEM_TOMBSTONE/acr'
      ])
      const found = parseTombstones(run.stdout).find(
        (t) => t.pid === entry.pid && t.packageUnderscored === underscored
      )
      if (found) return found
      if (attempt < TOMBSTONE_ATTEMPTS) await sleep(TOMBSTONE_RETRY_MS)
    }
    return undefined
  }

  // The cause from the crash report. Never throws: a crash is reported without its cause.
  async function crashCause(
    device: Device,
    pkg: VpmPackage,
    entry: CrashEntry
  ): Promise<Pick<LaunchCrash, 'signal' | 'language' | 'message' | 'stack'>> {
    try {
      const tombstone = await tombstoneOf(device, pkg, entry)
      if (!tombstone) return { stack: [] }
      const run = await ctx.deviceShell(device, [deviceScript(acrScript(Number(tombstone.index)))])
      const acr = parseAcr(run.stdout)
      const signal = acr?.signal ?? signalName(tombstone.signal)
      return {
        ...(signal ? { signal } : {}),
        ...(acr?.language ? { language: acr.language } : {}),
        ...(acr?.message ? { message: acr.message } : {}),
        stack: acr?.stack ?? []
      }
    } catch {
      return { stack: [] }
    }
  }

  return async (device, pkg, component, launch, onVerifying) => {
    // Checked as `fromDevice` does: the package ID goes into the stop script.
    const packageId = assertAppId(pkg.id, { from: 'device', device: device.name })
    const keyOf = (e: CrashEntry) => `${e.pid}|${e.timestamp}`
    const baseline = new Set((await crashHistory(device)).map(keyOf))
    const newCrash = (entries: CrashEntry[]) =>
      entries.find((e) => e.packageId === pkg.id && !baseline.has(keyOf(e)))
    const capture = await startCapture(device)

    let crash: CrashEntry | undefined
    let running: VlcmEntry | undefined
    let cause: Pick<LaunchCrash, 'signal' | 'language' | 'message' | 'stack'> = { stack: [] }
    let logs: string[] = []
    try {
      await launch()
      onVerifying?.()
      // Count-based, so there is no clock to fake (ARCHITECTURE §9).
      let last: VlcmEntry[] = []
      for (let i = 0; i < SETTLE_MS / POLL_MS; i++) {
        await sleep(POLL_MS)
        last = parseVlcmList(
          (await ctx.shell(device, ['vlcm', 'list', '--app-id', component], 'the running app'))
            .stdout
        )
      }
      // pid 0 is `IDLE` right after `launch-app`, not running.
      running = last.find((r) => r.application === component && r.pid > 0)
      crash = newCrash(await crashHistory(device))
      if (!crash && !running) {
        await sleep(RECHECK_MS)
        crash = newCrash(await crashHistory(device))
      }
      if (crash) cause = await crashCause(device, pkg, crash)
    } finally {
      // Always stopped, also when the launch or a read failed: `timeout` is only the fallback.
      if (capture) {
        const stopped = await stopCapture(device, capture, packageId, crash?.pid ?? 0)
        if (crash) logs = stopped
      }
    }

    if (crash) {
      return {
        verified: false,
        reason: 'crashed',
        crash: {
          pid: crash.pid,
          time: new Date(crash.killTimeMs).toISOString(),
          ...cause,
          logs
        }
      }
    }
    if (running) return { verified: true, pid: running.pid }
    return { verified: false, reason: 'not-running' }
  }
}
