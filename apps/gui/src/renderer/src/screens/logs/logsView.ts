import type { Device, LogEntry, LogExportFormat } from '@ovd/core'
import type { LogsFilter, LogsState } from '../../../../preload/api'
import type { SelectOption } from '../../ui/Select'
import { appsBlocker } from '../apps/appsView'

export type LevelLetter = 'v' | 'd' | 'i' | 'w' | 'e'

export const LEVELS: readonly { id: LevelLetter; label: string; title: string }[] = [
  { id: 'v', label: 'V', title: 'Verbose' },
  { id: 'd', label: 'D', title: 'Debug' },
  { id: 'i', label: 'I', title: 'Info' },
  { id: 'w', label: 'W', title: 'Warn' },
  { id: 'e', label: 'E', title: 'Error' }
]

// The package picker's values for "everything" and "system processes" (app IDs have a dot).
export const ALL_PACKAGES = 'all'
export const SYSTEM_PACKAGES = 'system'

const LONG: Record<LevelLetter, string | null> = {
  v: null,
  d: 'debug',
  i: 'info',
  w: 'warn',
  e: 'error'
}

// The `ovd …` name of a level; null for V (everything), which needs no flag.
export function levelName(level: string | undefined): string | null {
  if (level === undefined) return null
  return LONG[level.toLowerCase() as LevelLetter] ?? null
}

// The `ovd logs …` that shows what the screen shows (ADR 0005), in the CLI's flag order.
export function logsCli(filter: LogsFilter, device: string, restartAfterInstall = true): string {
  return [...logsFlags(filter, restartAfterInstall), `--device ${shellQuote(device)}`].join(' ')
}

export interface LogsExportEcho {
  path: string
  format: LogExportFormat
  // The time of the last exported line: the CLI command ends where the snapshot ends.
  until: string
  // The file existed and the save dialog confirmed replacing it.
  replaced: boolean
}

// The `ovd logs … --export` that writes what Export saved. Approximate where a pause cut the
// lines by entry number: lines that arrived after the pause with an earlier time are in range.
export function logsExportCli(
  filter: LogsFilter,
  device: string,
  restartAfterInstall: boolean,
  exported: LogsExportEcho
): string {
  return [
    ...logsFlags(filter, restartAfterInstall),
    `--until ${shellQuote(exported.until)}`,
    `--export ${shellQuote(exported.path)}`,
    ...(exported.format === 'text' ? [] : [`--format ${exported.format}`]),
    ...(exported.replaced ? ['--force'] : []),
    `--device ${shellQuote(device)}`
  ].join(' ')
}

function logsFlags(filter: LogsFilter, restartAfterInstall: boolean): string[] {
  const parts = ['ovd logs']
  if (filter.app) parts.push(`--app ${shellQuote(filter.app)}`)
  else if (filter.system) parts.push('--system')
  const level = levelName(filter.level)
  if (level) parts.push(`--level ${level}`)
  if (filter.search) {
    // The search is always quoted, so the echo reads `--grep "tick"` (e2e asserts it).
    parts.push(`--grep ${doubleQuote(filter.search)}`)
    if (filter.regex) parts.push('--regex')
  }
  if (!restartAfterInstall) parts.push('--no-restart-after-install')
  return parts
}

// Characters a shell never expands or splits on in a word: app IDs, serials, `IP:port`.
const SHELL_SAFE = /^[A-Za-z0-9._:/@%+=,-]+$/

// One word for a copyable command: a safe value as it is, anything else in single quotes
// (nothing expands inside them; a `'` closes, adds an escaped one and reopens).
export function shellQuote(text: string): string {
  if (SHELL_SAFE.test(text)) return text
  return `'${text.replaceAll("'", `'\\''`)}'`
}

// Double quotes, with what a shell expands inside them escaped.
function doubleQuote(text: string): string {
  return `"${text.replace(/[\\"$`]/g, (c) => `\\${c}`)}"`
}

// Core's app-ID rule (packages/core/src/deviceApps/appId.ts); the renderer can't import core
// runtime code (docs/conventions/gui.md).
const APP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

// All, each app seen in the log plus the open project's app, then System. The project's ID
// comes from a manifest.toml anyone could have written, so it is offered only when it is an
// app ID.
export function packageChoices(apps: string[], projectAppId: string | null): SelectOption[] {
  const project = projectAppId !== null && APP_ID.test(projectAppId) ? [projectAppId] : []
  const ids = [...new Set([...apps, ...project])].sort()
  return [
    { value: ALL_PACKAGES, label: 'All' },
    ...ids.map((id) => ({ value: id, label: id })),
    { value: SYSTEM_PACKAGES, label: 'System' }
  ]
}

export function packageValue(filter: LogsFilter): string {
  if (filter.app) return filter.app
  return filter.system ? SYSTEM_PACKAGES : ALL_PACKAGES
}

// The filter with the package picker's choice applied.
export function withPackage(filter: LogsFilter, value: string): LogsFilter {
  const rest = without(filter, 'app', 'system')
  if (value === ALL_PACKAGES) return rest
  if (value === SYSTEM_PACKAGES) return { ...rest, system: true }
  return { ...rest, app: value }
}

// The filter without some of its keys.
export function without(filter: LogsFilter, ...keys: (keyof LogsFilter)[]): LogsFilter {
  const out: LogsFilter = { ...filter }
  for (const key of keys) delete out[key]
  return out
}

// The search hits in a line, case-insensitive; an invalid regex has none.
export function highlightSegments(
  text: string,
  search: string,
  regex: boolean
): { text: string; hit: boolean }[] {
  if (search === '') return [{ text, hit: false }]
  let pattern: RegExp
  try {
    pattern = new RegExp(regex ? search : escapeRegex(search), 'gi')
  } catch {
    return [{ text, hit: false }]
  }
  const out: { text: string; hit: boolean }[] = []
  let at = 0
  for (const match of text.matchAll(pattern)) {
    if (match[0] === '') continue
    const start = match.index
    if (start > at) out.push({ text: text.slice(at, start), hit: false })
    out.push({ text: match[0], hit: true })
    at = start + match[0].length
  }
  if (at < text.length || out.length === 0) out.push({ text: text.slice(at), hit: false })
  return out
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// `HH:MM:SS.mmm` in host local time, as `ovd logs` prints it.
export function timeOfDay(iso: string): string {
  const date = new Date(iso)
  const two = (n: number) => String(n).padStart(2, '0')
  const ms = String(date.getMilliseconds()).padStart(3, '0')
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.${ms}`
}

// "Fire TV stick · since 07:27:00" for a session that started; the name alone otherwise.
export function sessionLabel(state: LogsState): string {
  if (state.status === 'idle') return ''
  const startedAt = state.status === 'starting' ? null : state.startedAt
  if (startedAt === null) return state.name
  return `${state.name} · since ${timeOfDay(startedAt).slice(0, 8)}`
}

// Why the log can't be read, or null when it can (as the Apps screen decides it).
// The device of a session main keeps while there's no target at all (the only online device
// dropped, nothing remembered): it's reconnecting, so the screen stays on it. Null otherwise.
export function heldDevice(state: LogsState, target: Device | undefined): string | null {
  if (target !== undefined) return null
  return state.status === 'running' || state.status === 'reconnecting' ? state.device : null
}

export function logsBlocker(target: Device | undefined): 'no-target' | 'offline' | null {
  return appsBlocker(target)
}

// The checks a regex search gets before it reaches main: null when it compiles.
export function regexError(search: string, regex: boolean): string | null {
  if (!regex || search === '') return null
  try {
    new RegExp(search, 'i')
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

// "Logs at crash time" (Stage 5.1): Crashes asks Logs to filter on the crash's app and show
// the crash's time. `n` tells two requests for the same crash apart.
export interface CrashLogsRequest {
  n: number
  app: string
  // ISO time of the crash.
  time: string
}

// The journal rotates fast, so a crash is in the log only when a session was running before
// it (ARCHITECTURE §8).
export const ROTATION_HINT =
  'The device journal rotates fast, so lines from before this session are gone. To catch a crash, start logs (or use Run) before launching the app.'

// The ring keeps this many lines; a session that has seen as many may have dropped the start.
const RING_FULL = 100_000

// Whether the session's buffer reaches back to `time`: it started before the crash and has not
// yet dropped its oldest lines.
export function coversTime(startedAt: string | null, lines: number, time: string): boolean {
  if (startedAt === null || lines >= RING_FULL) return false
  const start = Date.parse(startedAt)
  const crash = Date.parse(time)
  return Number.isFinite(start) && Number.isFinite(crash) && start <= crash
}

// The row to bring into view: the first line at or after `time`, else the last line before it;
// -1 for an empty list. Entries are in time order.
export function indexAtTime(entries: readonly LogEntry[], time: string): number {
  if (entries.length === 0) return -1
  const at = Date.parse(time)
  const found = entries.findIndex((entry) => Date.parse(entry.time) >= at)
  return found === -1 ? entries.length - 1 : found
}

export type CrashLogsOutcome =
  { kind: 'scroll'; index: number } | { kind: 'note'; title: string; body: string }

// What "Logs at crash time" does once the buffer is filtered on the app: scroll to the crash's
// time when the session started before it, else say the journal rotates fast.
export function crashLogsOutcome(
  request: CrashLogsRequest,
  session: { startedAt: string | null; lines: number },
  entries: readonly LogEntry[]
): CrashLogsOutcome {
  if (!coversTime(session.startedAt, session.lines, request.time)) {
    return {
      kind: 'note',
      title: `No lines of ${request.app} from before this session`,
      body: ROTATION_HINT
    }
  }
  const index = indexAtTime(entries, request.time)
  if (index === -1) {
    return {
      kind: 'note',
      title: `No lines of ${request.app} in this session`,
      body: 'The app logged nothing since the session started.'
    }
  }
  return { kind: 'scroll', index }
}
