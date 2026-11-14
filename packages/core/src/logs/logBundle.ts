import { randomBytes } from 'node:crypto'
import { basename } from 'node:path'
import type { ActivityLog } from '../activity/activityLog.js'
import { SURFACES } from '../activity/activityLog.js'
import { createPreflight } from '../activity/logged.js'
import { writeZip, ZipError } from '../archive/zipWriter.js'
import type { Crashes } from '../crashes/types.js'
import { isAppId } from '../deviceApps/appId.js'
import type { Devices } from '../devices/devices.js'
import { onlineTarget } from '../devices/onlineTarget.js'
import type { Device } from '../devices/types.js'
import { ERROR_CODES, OvdError, type ErrorCode } from '../errors/ovdError.js'
import type { SdkLocator } from '../sdk/sdkLocator.js'
import { slug } from '../screenshot/captures.js'
import {
  commitFile,
  nodeSaveFs,
  removeQuietly,
  resolveDestination,
  saveError,
  tempFor,
  writePart,
  ZIP_KIND,
  type Destination,
  type SaveFs
} from '../screenshot/saveFile.js'
import { bundlesDir, ensureBundlesDir } from './bundlesDir.js'
import { compileLogFilter, type LogFilterInput } from './logFilter.js'
import { levelLongName } from './logLevel.js'
import { compileProcessRules } from './processRules.js'
import { logJson } from './logExport.js'
import { logText, ovdEventText } from './logText.js'
import { assertFilterName } from './savedFilters.js'
import type { Logs } from './logSession.js'
import type { LogEntry, OvdEvent } from './types.js'

// A log bundle (ADR 0026): one `.zip` made to be attached to a bug report. Everything in it
// except the logs comes from a fixed template or from validated fields, and OVD's own lines are
// rebuilt without folders or file paths. The device's log text is copied as received.

export const DEFAULT_BUNDLE_SECONDS = 5
export const MAX_BUNDLE_SECONDS = 300

export const BUNDLE_FILES = [
  'README.txt',
  'manifest.json',
  'logs.txt',
  'logs.jsonl',
  'apps.json',
  'crashes.json'
] as const

export const BUNDLE_WARNING =
  'The logs in this bundle are copied as the device printed them and may hold tokens, user data or addresses. Review them before you share the bundle.'

const README = `OVD log bundle
==============

${BUNDLE_WARNING}
OVD doesn't redact the log lines.

Files
-----
manifest.json  What this bundle was made from: OVD and SDK versions, the device's name,
               model, OS and architecture, the time range, the line count and the filter.
               A search text is recorded only as "set".
logs.txt       The log lines in the text format of "ovd logs".
logs.jsonl     The same lines, one JSON object per line, as "ovd logs --json" prints them.
apps.json      The side-loaded apps on the device: package ID and version.
crashes.json   The crash reports of those apps: metadata only, no report contents.

OVD adds no serials, IP addresses or host paths of its own, and no screenshots, crash report
files or activity log. Lines copied from the device may contain such things.

Made by OVD (Open Vega DevTools), an unofficial toolkit for Vega OS developers.
`

export interface BundleOptions {
  // `--device`; the selected target by default.
  device?: string
  filter?: LogFilterInput
  // The built-in preset or saved filter the filter came from, recorded by name.
  preset?: string
  // A `.zip` file or an existing folder, relative to the core's working directory.
  out?: string
  force?: boolean
  signal?: AbortSignal
}

export interface BundleCaptureOptions extends BundleOptions {
  // The journal's backlog plus this many seconds of the live stream: 1..300, default 5.
  durationS?: number
}

export interface BundleEntriesOptions extends BundleOptions {
  // The desktop's buffer, already filtered.
  entries: readonly LogEntry[]
}

export interface BundleResult {
  device: { id: string; name: string }
  // Absolute.
  path: string
  bytes: number
  lines: number
  files: string[]
}

export interface LogBundle {
  bundle(opts?: BundleCaptureOptions): Promise<BundleResult>
  bundleEntries(opts: BundleEntriesOptions): Promise<BundleResult>
  dir(): string
}

export interface LogBundleDeps {
  logs: Pick<Logs, 'start'>
  devices: Devices
  sdk: SdkLocator
  activity: ActivityLog
  crashes: Pick<Crashes, 'list'>
  // The side-loaded apps with their versions.
  apps: (device: Device) => Promise<readonly { packageId: string; version?: string }[]>
  env: Record<string, string | undefined>
  homedir: string
  cwd: string
  now: () => Date
  ovdVersion?: string
  fs?: SaveFs
  randomHex?: () => string
  // For tests: waits `ms`, or until `signal` aborts.
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

// OVD's own lines without anything that names a host path. Every event is rebuilt from an
// allow-list of fields, each checked against a pattern or a list: the events of the desktop's
// buffer come from the renderer, so none of them is trusted. A build event keeps neither its
// folder nor its file.
type BundleEvent = Exclude<OvdEvent, { kind: 'build' }> | { kind: 'build' }

const SIGNAL = /^[A-Za-z0-9_+-]{1,16}$/
const PROCESS = /^[A-Za-z0-9._-]{1,64}$/
const SECOND = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/

const appOf = (value: unknown): { app: string } | Record<string, never> =>
  typeof value === 'string' && isAppId(value) ? { app: value } : {}
const signalOf = (value: unknown): { signal: string } | Record<string, never> =>
  typeof value === 'string' && SIGNAL.test(value) ? { signal: value } : {}
const intOf = <K extends string>(
  key: K,
  value: unknown
): { [P in K]: number } | Record<string, never> =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? ({ [key]: value } as { [P in K]: number })
    : {}
const errorCodeOf = (value: unknown): { errorCode: ErrorCode } | Record<string, never> =>
  typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value)
    ? { errorCode: value as ErrorCode }
    : {}
const surfaceOf = (value: unknown): (typeof SURFACES)[number] =>
  SURFACES.find((surface) => surface === value) ?? 'cli'

function sanitizeEvent(event: OvdEvent): { event: BundleEvent; text: string } {
  switch (event.kind) {
    case 'build':
      return { event: { kind: 'build' }, text: 'New build' }
    case 'install': {
      const clean: OvdEvent = {
        kind: 'install',
        action: event.action === 'app.reinstall' ? 'app.reinstall' : 'app.install',
        surface: surfaceOf(event.surface),
        result: event.result === 'ok' ? 'ok' : 'error',
        ...(typeof event.package === 'string' && isAppId(event.package)
          ? { package: event.package }
          : {}),
        ...appOf(event.app),
        ...errorCodeOf(event.errorCode)
      }
      return { event: clean, text: ovdEventText(clean) }
    }
    case 'launch': {
      const results = ['verified', 'crashed', 'not-running', 'failed'] as const
      const clean: OvdEvent = {
        kind: 'launch',
        action: event.action === 'app.restart' ? 'app.restart' : 'app.launch',
        surface: surfaceOf(event.surface),
        result: results.find((result) => result === event.result) ?? 'failed',
        ...appOf(event.app),
        ...intOf('pid', event.pid),
        ...signalOf(event.signal),
        ...errorCodeOf(event.errorCode)
      }
      return { event: clean, text: ovdEventText(clean) }
    }
    case 'crash': {
      const clean: OvdEvent = {
        kind: 'crash',
        ...appOf(event.app),
        ...intOf('pid', event.pid),
        ...signalOf(event.signal),
        ...intOf('index', event.index)
      }
      return { event: clean, text: ovdEventText(clean) }
    }
    case 'rate-limited': {
      const clean: OvdEvent = {
        kind: 'rate-limited',
        process:
          typeof event.process === 'string' && PROCESS.test(event.process)
            ? event.process
            : 'unknown',
        hidden: Number.isSafeInteger(event.hidden) && event.hidden >= 0 ? event.hidden : 0,
        second:
          typeof event.second === 'string' && SECOND.test(event.second) ? event.second : 'unknown'
      }
      return { event: clean, text: ovdEventText(clean) }
    }
    case 'restarted': {
      const clean: OvdEvent = { kind: 'restarted', reason: 'install' }
      return { event: clean, text: ovdEventText(clean) }
    }
    case 'disconnected':
    case 'reconnected':
    case 'boot-unknown':
    case 'boot-late':
    case 'app-list-unavailable': {
      const clean: OvdEvent = { kind: event.kind }
      return { event: clean, text: ovdEventText(clean) }
    }
    default:
      return assertNever(event)
  }
}

function assertNever(value: never): never {
  throw new Error(`logBundle: unhandled OVD event ${JSON.stringify(value)}`)
}

// The two renderings of the bundle's logs. `logText` prints an OVD line from its `message`, so
// the text entry only needs some event for it to see; the JSON line carries the clean event.
function renderLogs(entries: readonly LogEntry[]): { text: string; jsonl: string } {
  const text: string[] = []
  const jsonl: string[] = []
  for (const entry of entries) {
    if (entry.ovd === undefined) {
      text.push(logText(entry))
      jsonl.push(JSON.stringify(logJson(entry)))
      continue
    }
    const clean = sanitizeEvent(entry.ovd)
    const shown: OvdEvent = clean.event.kind === 'build' ? { kind: 'build', file: '' } : clean.event
    text.push(logText({ ...entry, message: clean.text, ovd: shown }))
    jsonl.push(JSON.stringify({ time: entry.time, ovd: clean.event, message: clean.text }))
  }
  return {
    text: text.join(''),
    jsonl: jsonl.map((line) => `${line}\n`).join('')
  }
}

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROLS = /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/g

// Device-reported text for the manifest: no controls, bounded.
function clean(value: string, max = 80): string {
  return Array.from(value.replace(CONTROLS, '')).slice(0, max).join('')
}

// The device's OVD name. A name that holds the serial, the address or the ID (a rename, say),
// or four or more characters of them (the default multi-stick name ends in the serial's last
// four), would put them in every file name and the manifest, so it's replaced by the kind.
const MIN_LEAK = 4

function sharesPart(name: string, secret: string): boolean {
  if (secret.length < MIN_LEAK) return name.includes(secret)
  const lower = name.toLowerCase()
  const chars = Array.from(secret.toLowerCase())
  for (let i = 0; i + MIN_LEAK <= chars.length; i++) {
    if (lower.includes(chars.slice(i, i + MIN_LEAK).join(''))) return true
  }
  return false
}

function deviceName(device: Device): string {
  const name = clean(device.name, 64)
  const secrets = [device.id, device.serial, device.vdaSerial, device.ip].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  )
  if (name !== '' && !secrets.some((secret) => sharesPart(name, secret))) return name
  return device.kind === 'vvd' ? 'Vega Virtual Device' : 'Fire TV stick'
}

// The manifest's filter: the compiled arguments, except the free-text ones (tag, identity, a
// rule's identity), which can hold anything the user typed (S2). Those are recorded as counts;
// the rule levels and rates stay, under the rule's number instead of its identity.
function maskedFilter(
  args: Record<string, string>,
  input: LogFilterInput | undefined
): Record<string, string> {
  const { tag, identity, mute } = args
  const out: Record<string, string> = { ...args }
  for (const key of ['tag', 'identity', 'mute', 'process-level', 'process-rate']) delete out[key]
  const count = (value: string | undefined, items: readonly string[] | undefined) => {
    if (value === undefined) return
    const n = new Set(items).size
    return `${n === 0 ? 'some' : n} value${n === 1 ? '' : 's'}`
  }
  const tags = count(tag, input?.tag)
  if (tags !== undefined) out.tag = tags
  const identities = count(identity, input?.identity)
  if (identities !== undefined) out.identity = identities
  const rules = compileProcessRules(input?.processRules ?? [])
  const levels = rules.flatMap((r, i) => (r.level ? [`#${i + 1}=${levelLongName(r.level)}`] : []))
  const rates = rules.flatMap((r, i) => (r.rate === undefined ? [] : [`#${i + 1}=${r.rate}`]))
  const muted = rules.filter((r) => r.mute).length
  if (levels.length > 0) out['process-level'] = levels.join(',')
  if (rates.length > 0) out['process-rate'] = rates.join(',')
  if (mute !== undefined) out.mute = `${muted} value${muted === 1 ? '' : 's'}`
  return out
}

function stamp(at: Date): string {
  return at.toISOString().replace(/\..*$/, '').replace(/[-:]/g, '').replace('T', '-')
}

function failureCode(error: unknown): ErrorCode {
  return error instanceof OvdError ? error.code : 'COMMAND_FAILED'
}

function abortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

function parseSeconds(value: number | undefined): number {
  const seconds = value ?? DEFAULT_BUNDLE_SECONDS
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_BUNDLE_SECONDS) {
    throw new OvdError(
      'INVALID_TIMEOUT',
      `--duration must be a whole number of seconds from 1 to ${MAX_BUNDLE_SECONDS}, not ${JSON.stringify(value)}`,
      'Pass for example --duration 10'
    )
  }
  return seconds
}

export function createLogBundle(deps: LogBundleDeps): LogBundle {
  const preflight = createPreflight(deps.activity)
  const fs = deps.fs ?? nodeSaveFs
  const randomHex = deps.randomHex ?? (() => randomBytes(4).toString('hex'))
  const sleep = deps.sleep ?? defaultSleep
  const dir = bundlesDir(deps.env, deps.homedir)

  // Everything checked before any SDK call or device read: the filter, the preset name, the
  // duration (when given) and the destination.
  async function prepare(
    opts: BundleOptions,
    seconds: number | undefined,
    capture: boolean
  ): Promise<{ device: Device; dest: Destination; filterArgs: Record<string, string> }> {
    return preflight('logs.bundle', async (known) => {
      const filterArgs = compileLogFilter(opts.filter ?? {}, deps.now()).args
      if (opts.preset !== undefined) assertPresetLabel(opts.preset)
      if (capture) parseSeconds(seconds)
      const dest = await resolveDestination({
        out: opts.out,
        force: opts.force ?? false,
        cwd: deps.cwd,
        capturesDir: dir,
        kind: ZIP_KIND
      })
      const device = await onlineTarget(deps.devices, opts.device)
      known.target = device.id
      return { device, dest, filterArgs }
    })
  }

  // A preset is a built-in key or a saved name: both are slugs, so a hostile string can't reach
  // the manifest.
  function assertPresetLabel(name: string): void {
    if (/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) return
    assertFilterName(name)
  }

  async function capture(
    device: Device,
    opts: BundleCaptureOptions,
    seconds: number
  ): Promise<LogEntry[]> {
    const session = await deps.logs.start({
      device: device.id,
      filter: opts.filter ?? {},
      ...(opts.signal ? { signal: opts.signal } : {})
    })
    try {
      await Promise.race([
        sleep(seconds * 1000, opts.signal),
        session.done.then((end) => {
          if (end.reason === 'ended') throw end.error
        })
      ])
      if (opts.signal?.aborted) throw abortError()
      return session.entries()
    } finally {
      await session.stop()
    }
  }

  async function read<T>(
    run: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<{ ok: true; value: T } | { ok: false; code: ErrorCode }> {
    try {
      return { ok: true, value: await run() }
    } catch (error) {
      if (signal?.aborted) throw abortError()
      return { ok: false, code: failureCode(error) }
    }
  }

  async function assemble(
    device: Device,
    entries: readonly LogEntry[],
    source: 'capture' | 'buffer',
    filterArgs: Record<string, string>,
    opts: BundleOptions
  ): Promise<Buffer> {
    const at = deps.now()
    const sdk = await read(() => deps.sdk.get(), opts.signal)
    const apps = await read(() => deps.apps(device), opts.signal)
    const crashes = await read(() => deps.crashes.list(device.id), opts.signal)
    const { grep, ...rest } = filterArgs
    const times = entries.map((entry) => entry.time).sort()
    const info = device.info
    const manifest = {
      format: 1,
      ovd: clean(deps.ovdVersion ?? 'unknown', 32),
      sdk: sdk.ok ? clean(sdk.value.sdkVersion, 32) : 'unknown',
      createdAt: at.toISOString(),
      source,
      device: {
        name: deviceName(device),
        kind: device.kind,
        ...(info
          ? {
              model: clean(info.product),
              os: clean(info.os),
              build: clean(info.build),
              architecture: clean(info.architecture, 32)
            }
          : {})
      },
      lines: entries.length,
      timeRange: times.length === 0 ? null : { from: times[0], to: times[times.length - 1] },
      // The search text is never recorded (it can hold anything the user typed, S2).
      filter: {
        ...maskedFilter(rest, opts.filter),
        ...(grep === undefined ? {} : { search: 'set' })
      },
      ...(opts.preset === undefined ? {} : { preset: opts.preset }),
      apps: apps.ok ? 'ok' : 'unavailable',
      ...(apps.ok ? {} : { appsError: apps.code }),
      crashes: crashes.ok ? 'ok' : 'unavailable',
      ...(crashes.ok ? {} : { crashesError: crashes.code })
    }
    const logs = renderLogs(entries)
    const appsJson = apps.ok
      ? {
          apps: apps.value.flatMap((app) =>
            isAppId(app.packageId)
              ? [
                  {
                    id: app.packageId,
                    ...(app.version === undefined ? {} : { version: clean(app.version, 64) })
                  }
                ]
              : []
          )
        }
      : { unavailable: true, error: apps.code }
    // Metadata only: the one-line summary is the app's own text, so it stays out.
    const crashesJson = crashes.ok
      ? {
          crashes: crashes.value.crashes.flatMap((crash) =>
            isAppId(crash.package)
              ? [
                  {
                    id: crash.id,
                    package: crash.package,
                    kind: crash.kind === 'js' ? 'js' : 'native',
                    signal: crash.signal,
                    ...(crash.signalName === undefined
                      ? {}
                      : { signalName: clean(crash.signalName, 32) }),
                    pid: crash.pid,
                    time: clean(crash.time, 40),
                    ...(crash.version === undefined ? {} : { version: clean(crash.version, 64) }),
                    ...(crash.build === undefined ? {} : { build: clean(crash.build, 64) })
                  }
                ]
              : []
          )
        }
      : { unavailable: true, error: crashes.code }
    const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
    try {
      return writeZip(
        [
          { name: 'README.txt', data: README },
          { name: 'manifest.json', data: json(manifest) },
          { name: 'logs.txt', data: logs.text },
          { name: 'logs.jsonl', data: logs.jsonl },
          { name: 'apps.json', data: json(appsJson) },
          { name: 'crashes.json', data: json(crashesJson) }
        ],
        { modified: at }
      )
    } catch (error) {
      if (error instanceof ZipError) {
        throw new OvdError(
          'LOG_BUNDLE_FAILED',
          `Couldn’t build the log bundle: ${error.message}`,
          'Narrow the filter or the time range, then retry'
        )
      }
      throw error
    }
  }

  async function save(
    device: Device,
    dest: Destination,
    zip: Buffer,
    lines: number
  ): Promise<BundleResult> {
    const base = `ovd-logs-${slug(deviceName(device))}-${stamp(deps.now())}`
    const ready: Destination = dest.kind === 'auto' ? { ...dest, create: false } : dest
    if (dest.kind === 'auto' && dest.create) await ensureBundlesDir(dest.dir)
    const temp = await tempFor(ready, base, randomHex(), ZIP_KIND)
    try {
      await writePart(temp, zip, ZIP_KIND)
      const path = await commitFile(temp, ready, base, fs, ZIP_KIND)
      return {
        device: { id: device.id, name: deviceName(device) },
        path,
        bytes: zip.length,
        lines,
        files: [...BUNDLE_FILES]
      }
    } finally {
      await removeQuietly(temp)
    }
  }

  // The part after the target is known: one activity entry, ok or error.
  async function finish(
    device: Device,
    opts: BundleOptions,
    run: () => Promise<BundleResult>
  ): Promise<BundleResult> {
    try {
      const result = await run()
      await deps.activity.append({
        action: 'logs.bundle',
        target: device.id,
        // Validated fields only: no filter text and no log lines (ADR 0026).
        args: { lines: result.lines, bytes: result.bytes, file: basename(result.path) },
        result: 'ok'
      })
      return result
    } catch (error) {
      if (opts.signal?.aborted) throw abortError()
      const failure = error instanceof OvdError ? error : saveError(dir, error, ZIP_KIND)
      await deps.activity.append({
        action: 'logs.bundle',
        target: device.id,
        args: {},
        result: 'error',
        errorCode: failure.code
      })
      throw failure
    }
  }

  return {
    dir: () => dir,

    async bundle(opts = {}) {
      const { device, dest, filterArgs } = await prepare(opts, opts.durationS, true)
      const seconds = parseSeconds(opts.durationS)
      return finish(device, opts, async () => {
        const entries = await capture(device, opts, seconds)
        const zip = await assemble(device, entries, 'capture', filterArgs, opts)
        return save(device, dest, zip, entries.length)
      })
    },

    async bundleEntries(opts) {
      const { device, dest, filterArgs } = await prepare(opts, undefined, false)
      return finish(device, opts, async () => {
        const zip = await assemble(device, opts.entries, 'buffer', filterArgs, opts)
        return save(device, dest, zip, opts.entries.length)
      })
    }
  }
}
