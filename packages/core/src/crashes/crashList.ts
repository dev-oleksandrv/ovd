import { parseAcr } from '../adapters/parseAcr.js'
import { parseTombstonesStrict, signalName, type Tombstone } from '../adapters/parseTombstones.js'
import { stripControl } from '../adapters/stripControl.js'
import { acrScript, deviceScript } from '../deviceApps/launchScripts.js'
import type { AppId } from '../deviceApps/appId.js'
import type { Devices } from '../devices/devices.js'
import { onlineTarget } from '../devices/onlineTarget.js'
import type { Device } from '../devices/types.js'
import { OvdError } from '../errors/ovdError.js'
import { vdaCmd } from '../sdk/commands.js'
import type { RunResult, Runner } from '../sdk/runner.js'
import type { SdkLocator } from '../sdk/sdkLocator.js'
import { createScope, type InstalledPackage } from './scope.js'
import type { Crash, CrashDetail, CrashesList } from './types.js'

// The listing keeps the newest reports only: a device can hold far more than a screen shows.
export const MAX_CRASHES = 200
const SUMMARY_MAX = 200
const READ_TIMEOUT_MS = 30_000
// What VDA prints when the device left between the target check and the call.
const GONE = /device '[^']*' not found|device offline|no devices\/emulators found/
const LEDGER_MAX = 1_000

// The reports a launch already told the user about (device + vault index, F9). The watcher
// doesn't announce them again.
export interface CrashLedger {
  add(deviceId: string, index: number): void
  has(deviceId: string, index: number): boolean
}

export function createCrashLedger(max = LEDGER_MAX): CrashLedger {
  // Insertion order: the oldest note goes first once the ledger is full.
  const keys = new Set<string>()
  const key = (deviceId: string, index: number) => `${deviceId}|${index}`
  return {
    add(deviceId, index) {
      keys.add(key(deviceId, index))
      if (keys.size > max) {
        const [oldest] = keys
        if (oldest !== undefined) keys.delete(oldest)
      }
    },
    has: (deviceId, index) => keys.has(key(deviceId, index))
  }
}

// One per process, as the core is: launch verification writes to it, the reader and the watcher
// read it. Keys carry the device ID, so cores of different tests don't meet.
export const launchReportedCrashes: CrashLedger = createCrashLedger()

// The vault index a crash id is, from what a user or a surface passed. INVALID_CRASH_ID before
// any SDK call, so nothing but an integer ever reaches a device script.
export function parseCrashId(value: string | number): number {
  const text = typeof value === 'number' ? String(value) : value
  if (/^(0|[1-9]\d{0,8})$/.test(text)) return Number(text)
  throw new OvdError(
    'INVALID_CRASH_ID',
    `${JSON.stringify(value)} isn’t a crash id`,
    'A crash id is the number ovd crashes shows'
  )
}

// A report in scope: its file name's fields and the installed package it stands for.
export interface CrashEntry {
  tombstone: Tombstone
  index: number
  packageId: AppId
}

export interface CrashScan {
  device: Device
  // In scope, newest first, at most MAX_CRASHES.
  entries: CrashEntry[]
  isNew(entry: CrashEntry): boolean
}

export interface CrashReader {
  // The listing only: one `vault --ls`, no report is read.
  scan(device: Device): Promise<CrashScan>
  // The row of one entry; reads its header once per device and index.
  crashOf(scan: CrashScan, entry: CrashEntry): Promise<Crash>
  list(device?: string): Promise<CrashesList>
  // An in-scope report by id: INVALID_CRASH_ID, or CRASH_NOT_FOUND when the id isn't listed
  // or isn't one of the developer's apps.
  find(id: string | number, device?: string): Promise<CrashDetail & { device: Device }>
}

export interface CrashReaderDeps {
  runner: Runner
  sdk: SdkLocator
  devices: Devices
  // Every package on the target with its source; the scope match runs against all of them.
  installed: (device: Device) => Promise<InstalledPackage[]>
  ledger?: CrashLedger
  now?: () => number
}

interface DeviceState {
  // The vault indexes of the first read: reports that were there before OVD looked.
  baseline: Set<number>
  // Header and stack by `index:epoch:pid`, only for entries still in the listing.
  details: Map<string, EntryDetail>
}

interface EntryDetail {
  stack: string[]
  reason?: string
  language?: string
  version?: string
  build?: string
  summary?: string
}

export function createCrashReader(deps: CrashReaderDeps): CrashReader {
  const ledger = deps.ledger ?? launchReportedCrashes
  const scope = createScope({
    read: deps.installed,
    ...(deps.now ? { now: deps.now } : {})
  })
  const states = new Map<string, DeviceState>()

  // A device shell call, whatever its exit code. Only a device that left is an error here.
  async function deviceShell(device: Device, command: string[]): Promise<RunResult> {
    const { vegaPath } = await deps.sdk.get()
    const run = await deps.runner.run(
      vdaCmd(vegaPath, ['shell', ...command], device.vdaSerial, { timeoutMs: READ_TIMEOUT_MS })
    )
    if (GONE.test(run.stderr) || GONE.test(run.stdout)) {
      throw new OvdError(
        'TARGET_OFFLINE',
        `${device.name} is offline`,
        device.kind === 'vvd'
          ? 'It may still be booting. Wait a few seconds and retry'
          : 'Reconnect it, then check with ovd devices'
      )
    }
    return run
  }

  const detailKey = (t: Tombstone) => `${t.index}:${t.epochS}:${t.pid}`

  async function scan(device: Device): Promise<CrashScan> {
    const run = await deviceShell(device, ['loggingctl', 'vault', '--ls', 'SYSTEM_TOMBSTONE/acr'])
    // A refused listing prints its JSON error with exit 0 (`parseTombstonesStrict` maps it).
    if (run.exitCode !== 0 && run.stdout.trim() === '') {
      throw new OvdError(
        'COMMAND_FAILED',
        `Couldn’t list the crash reports on ${device.name}`,
        'Retry',
        {
          exitCode: run.exitCode,
          stderr: run.stderr.slice(0, 200)
        }
      )
    }
    const all = parseTombstonesStrict(run.stdout)

    let state = states.get(device.id)
    if (state === undefined) {
      // The first read is the silent baseline: nothing in it is NEW.
      state = { baseline: new Set(all.map((t) => Number(t.index))), details: new Map() }
      states.set(device.id, state)
    }
    const live = new Set(all.map(detailKey))
    for (const key of state.details.keys()) if (!live.has(key)) state.details.delete(key)

    const packages = await scope.resolve(device, new Set(all.map((t) => t.packageUnderscored)))
    const entries = all
      .flatMap((tombstone): CrashEntry[] => {
        const packageId = packages.get(tombstone.packageUnderscored)
        return packageId === undefined
          ? []
          : [{ tombstone, index: Number(tombstone.index), packageId }]
      })
      .sort((a, b) => b.tombstone.epochS - a.tombstone.epochS || b.index - a.index)
      .slice(0, MAX_CRASHES)

    const { baseline } = state
    return {
      device,
      entries,
      isNew: (e) => !baseline.has(e.index) && !ledger.has(device.id, e.index)
    }
  }

  async function detailOf(scanned: CrashScan, entry: CrashEntry): Promise<EntryDetail> {
    const state = states.get(scanned.device.id)
    const key = detailKey(entry.tombstone)
    const cached = state?.details.get(key)
    if (cached) return cached
    const run = await deviceShell(scanned.device, [deviceScript(acrScript(entry.index))])
    // A refused or unknown report (-7, -8) parses to nothing: listed without its header.
    const acr = parseAcr(run.stdout)
    const summaryText = acr?.message ?? acr?.signal
    const detail: EntryDetail = {
      stack: acr?.stack ?? [],
      ...(acr?.signal ? { reason: acr.signal } : {}),
      ...(acr?.language ? { language: acr.language } : {}),
      ...(acr?.version ? { version: acr.version } : {}),
      ...(acr?.build ? { build: acr.build } : {}),
      ...(summaryText ? { summary: summary(summaryText) } : {})
    }
    // Not cached for a read that failed outright: it may work on the next poll.
    if (run.exitCode === 0 || acr !== undefined) state?.details.set(key, detail)
    return detail
  }

  async function crashOf(scanned: CrashScan, entry: CrashEntry): Promise<Crash> {
    return (await build(scanned, entry)).crash
  }

  async function build(scanned: CrashScan, entry: CrashEntry): Promise<CrashDetail> {
    const detail = await detailOf(scanned, entry)
    const { tombstone } = entry
    const name = signalName(tombstone.signal)
    const crash: Crash = {
      id: entry.index,
      package: entry.packageId,
      kind: detail.language === 'JavaScript' ? 'js' : 'native',
      signal: tombstone.signal,
      ...(name ? { signalName: name } : {}),
      pid: tombstone.pid,
      time: new Date(tombstone.epochS * 1000).toISOString(),
      ...(detail.version ? { version: detail.version } : {}),
      ...(detail.build ? { build: detail.build } : {}),
      ...(detail.summary ? { summary: detail.summary } : {}),
      new: scanned.isNew(entry)
    }
    return { crash, stack: detail.stack, ...(detail.reason ? { reason: detail.reason } : {}) }
  }

  return {
    scan,
    crashOf,

    async list(override) {
      const device = await onlineTarget(deps.devices, override)
      const scanned = await scan(device)
      const crashes: Crash[] = []
      for (const entry of scanned.entries) crashes.push(await crashOf(scanned, entry))
      return { device: device.id, crashes }
    },

    async find(id, override) {
      const index = parseCrashId(id)
      const device = await onlineTarget(deps.devices, override)
      const scanned = await scan(device)
      const entry = scanned.entries.find((e) => e.index === index)
      if (!entry) {
        throw new OvdError(
          'CRASH_NOT_FOUND',
          `No crash ${index} of your apps on ${device.name}`,
          'List them with ovd crashes'
        )
      }
      return { ...(await build(scanned, entry)), device }
    }
  }
}

// One line, control characters removed, at most SUMMARY_MAX characters.
function summary(text: string): string {
  const points = Array.from(stripControl(text).replace(/\s+/g, ' ').trim())
  return points.length > SUMMARY_MAX
    ? `${points.slice(0, SUMMARY_MAX - 1).join('')}…`
    : points.join('')
}
