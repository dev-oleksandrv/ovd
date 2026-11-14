import type { Device, LogEntry, LogExportFormat } from '@ovd/core'
import type { LogsFilter, LogsPreset, LogsState, SavedLogsFilter } from '../../../../preload/api'
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

// The level as the toolbar's letter: a filter from a preset or a saved filter may spell it as
// a name (`error`). Anything unknown is V.
export function levelLetter(level: string | undefined): LevelLetter {
  const first = level?.charAt(0).toLowerCase()
  return LEVELS.find((l) => l.id === first)?.id ?? 'v'
}

// The `ovd …` name of a level; null for V (everything), which needs no flag.
export function levelName(level: string | undefined): string | null {
  if (level === undefined) return null
  return LONG[levelLetter(level)]
}

// The `ovd logs …` that shows what the screen shows (ADR 0005), in the CLI's flag order. `base`
// is the built-in preset or saved filter the filter equals, if any (`presetMatch`): the echo is
// then `--preset <base>`.
export function logsCli(
  filter: LogsFilter,
  device: string,
  restartAfterInstall = true,
  base: string | null = null
): string {
  return [...logsFlags(filter, restartAfterInstall, base), `--device ${shellQuote(device)}`].join(
    ' '
  )
}

// `ovd logs filter save <name> <flags>`: what Save filter writes. A boot ID is never saved.
export function logsSaveCli(
  name: string,
  filter: LogsFilter,
  base: string | null = null,
  force = false
): string {
  return [
    'ovd logs filter save',
    shellQuote(name),
    ...filterFlags(without(filter, 'boot'), base),
    ...(force ? ['--force'] : [])
  ].join(' ')
}

export function logsRemoveCli(name: string): string {
  return `ovd logs filter rm ${shellQuote(name)}`
}

// `ovd logs bundle --device <id> <flags>`: the CLI captures the journal's backlog and a few
// seconds of the stream, where the desktop bundles the buffer it holds (F40).
export function logsBundleCli(filter: LogsFilter, device: string, base: string | null = null) {
  return ['ovd logs bundle', `--device ${shellQuote(device)}`, ...filterFlags(filter, base)].join(
    ' '
  )
}

export const BUNDLE_CLI_NOTE =
  'The command captures the device’s journal backlog and a few seconds of the live stream, not the lines this window holds.'

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
  exported: LogsExportEcho,
  base: string | null = null
): string {
  return [
    ...logsFlags(filter, restartAfterInstall, base),
    `--until ${shellQuote(exported.until)}`,
    `--export ${shellQuote(exported.path)}`,
    ...(exported.format === 'text' ? [] : [`--format ${exported.format}`]),
    ...(exported.replaced ? ['--force'] : []),
    `--device ${shellQuote(device)}`
  ].join(' ')
}

function logsFlags(
  filter: LogsFilter,
  restartAfterInstall: boolean,
  base: string | null
): string[] {
  const parts = ['ovd logs', ...filterFlags(filter, base)]
  if (!restartAfterInstall) parts.push('--no-restart-after-install')
  return parts
}

// The filter as CLI flags, in the CLI's order. A filter that equals a preset or saved filter is
// its `--preset`. Otherwise `appsOnly` and `lifecycle`, which have no flag of their own, come
// from the built-in preset that sets them, and the other fields are flags over it.
function filterFlags(filter: LogsFilter, base: string | null): string[] {
  if (base !== null && base !== 'all') return [`--preset ${shellQuote(base)}`]
  const parts: string[] = []
  const builtIn = filter.appsOnly ? 'app-errors' : filter.lifecycle ? 'lifecycle' : null
  if (filter.app) parts.push(`--app ${shellQuote(filter.app)}`)
  else if (filter.system) parts.push('--system')
  const level = levelName(filter.level)
  if (level) parts.push(`--level ${level}`)
  // The `app-errors` preset sets the level to error: a filter without a level says so.
  else if (builtIn === 'app-errors') parts.push('--level verbose')
  if (filter.search) {
    // The search is always quoted, so the echo reads `--grep "tick"` (e2e asserts it).
    parts.push(`--grep ${doubleQuote(filter.search)}`)
    if (filter.regex) parts.push('--regex')
  }
  for (const [flag, values] of [
    ['pid', filter.pid],
    ['tid', filter.tid],
    ['tag', filter.tag],
    ['identity', filter.identity],
    ['facility', filter.facility],
    ['boot', filter.boot]
  ] as const) {
    for (const value of values ?? []) parts.push(`--${flag} ${shellQuote(String(value))}`)
  }
  if (builtIn !== null) parts.push(`--preset ${builtIn}`)
  const rules = filter.processRules ?? []
  for (const rule of rules) {
    if (rule.level !== undefined) {
      parts.push(
        `--process-level ${shellQuote(`${rule.identity}=${rule.level.charAt(0).toUpperCase()}`)}`
      )
    }
  }
  for (const rule of rules) {
    if (rule.rate !== undefined) {
      parts.push(`--process-rate ${shellQuote(`${rule.identity}=${rule.rate}`)}`)
    }
  }
  for (const rule of rules) if (rule.mute) parts.push(`--mute ${shellQuote(rule.identity)}`)
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

// The filter with the package picker's choice applied. `appsOnly` goes with `app` and `system`
// (core's override group, F18): "App errors only" then System would otherwise be refused.
export function withPackage(filter: LogsFilter, value: string): LogsFilter {
  const rest = without(filter, 'app', 'system', 'appsOnly')
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
  // The crashed process: the filter shows its lines only (F45).
  pid: number
  // ISO time of the crash.
  time: string
}

// The journal rotates fast, so a crash is in the log only when a session was running before
// it (ARCHITECTURE §8).
export const ROTATION_HINT =
  'The device journal rotates fast, so lines from before this session are gone. To catch a crash, start logs (or use Run) before launching the app.'

// Whether the retained history reaches back to `time`: its oldest line (core's `counts.oldest`,
// after any Clear or eviction) is at or before it. An empty history covers nothing.
export function coversTime(oldest: string | null | undefined, time: string): boolean {
  if (oldest === null || oldest === undefined) return false
  const first = Date.parse(oldest)
  const crash = Date.parse(time)
  return Number.isFinite(first) && Number.isFinite(crash) && first <= crash
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
// time when the retained history reaches back to it, else say the journal rotates fast.
export function crashLogsOutcome(
  request: CrashLogsRequest,
  session: { lines: number; oldest?: string },
  entries: readonly LogEntry[]
): CrashLogsOutcome {
  if (!coversTime(session.oldest, request.time)) {
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

// What core enforces on filter input; the renderer can't import core runtime code, so the
// numbers are repeated here and a main test checks they match.
export const FILTER_TEXT_MAX = 128
export const MAX_PROCESS_RATE = 10_000
export const MAX_FILTER_NAME_CHARS = 40
export const LOG_FACILITIES: readonly string[] = [
  'kern',
  'user',
  'mail',
  'daemon',
  'auth',
  'syslog',
  'lpr',
  'news',
  'uucp',
  'cron',
  'authpriv',
  'ftp',
  ...Array.from({ length: 8 }, (_, i) => `local${i}`)
]

// A saved filter's name (F21).
const FILTER_NAME = /^[a-z0-9][a-z0-9-]*$/

// Why `name` can't be a saved filter's name, or null: core's rule, shown before the save.
// `reserved` holds the built-in preset keys.
export function filterNameError(name: string, reserved: readonly string[]): string | null {
  if (name === '') return 'Enter a name'
  if (name.length > MAX_FILTER_NAME_CHARS) {
    return `Use at most ${MAX_FILTER_NAME_CHARS} characters`
  }
  if (!FILTER_NAME.test(name)) {
    return 'Use lower-case letters, digits and hyphens, starting with a letter or a digit'
  }
  if (reserved.includes(name)) return `${name} is the name of a built-in preset`
  return null
}

// A filter field's value the user typed, as the filter takes it, or why not. PID and TID are
// non-negative integers; tag and identity 1–128 characters without control characters; a boot
// ID is 32 hex characters (dashes allowed).
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

export function parseNumberValue(text: string, label: string): Parsed<number> {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) {
    return { ok: false, error: `${label} is a non-negative whole number` }
  }
  return { ok: true, value: Number(trimmed) }
}

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

export function parseWordValue(text: string, label: string): Parsed<string> {
  if (text === '' || Array.from(text).length > FILTER_TEXT_MAX) {
    return { ok: false, error: `${label} needs 1–${FILTER_TEXT_MAX} characters` }
  }
  if (CONTROL.test(text)) return { ok: false, error: `${label} can’t hold control characters` }
  return { ok: true, value: text }
}

export function parseBootValue(text: string): Parsed<string> {
  const trimmed = text.trim().toLowerCase()
  if (trimmed === 'current' || /^[0-9a-f]{32}$/.test(trimmed.replaceAll('-', ''))) {
    return { ok: true, value: trimmed }
  }
  return { ok: false, error: 'A boot ID is 32 hex characters' }
}

export function parseRateValue(text: string): Parsed<number> {
  const parsed = parseNumberValue(text, 'The limit')
  if (!parsed.ok) return parsed
  if (parsed.value < 1 || parsed.value > MAX_PROCESS_RATE) {
    return { ok: false, error: `The limit is from 1 to ${MAX_PROCESS_RATE} lines per second` }
  }
  return parsed
}

// A filter in one comparable form: unset, false and empty fields dropped, the level by its
// long name (V is no filter), a regex flag only with a search.
function canonical(filter: LogsFilter): string {
  const level = levelName(filter.level)
  const entries: [string, unknown][] = [
    ['app', filter.app || undefined],
    ['system', filter.system || undefined],
    ['level', level ?? undefined],
    ['search', filter.search || undefined],
    ['regex', filter.search && filter.regex ? true : undefined],
    ['appsOnly', filter.appsOnly || undefined],
    ['lifecycle', filter.lifecycle || undefined],
    ['pid', filter.pid?.map(String)],
    ['tid', filter.tid?.map(String)],
    ['tag', filter.tag],
    ['identity', filter.identity],
    ['facility', filter.facility],
    ['boot', filter.boot],
    [
      'processRules',
      filter.processRules?.map((rule) => [
        rule.identity,
        rule.level?.charAt(0).toUpperCase() ?? null,
        rule.rate === undefined ? null : Number(rule.rate),
        rule.mute === true
      ])
    ]
  ]
  return JSON.stringify(
    entries.filter(
      ([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0)
    )
  )
}

// The built-in preset or saved filter the filter equals, by its key or name; null for any other
// filter: the row shows "Custom" then (F19). An invalid saved filter never matches.
export function presetMatch(
  filter: LogsFilter,
  presets: readonly LogsPreset[],
  saved: readonly SavedLogsFilter[]
): string | null {
  const wanted = canonical(filter)
  for (const preset of presets) if (canonical(preset.filter) === wanted) return preset.key
  for (const item of saved) if (item.valid && canonical(item.filter) === wanted) return item.name
  return null
}

// A removable chip for one active filter value or rule.
export interface FilterChipInfo {
  id: string
  label: string
  // The filter without it.
  remove: (filter: LogsFilter) => LogsFilter
}

function withoutValue<K extends 'pid' | 'tid' | 'tag' | 'identity' | 'facility' | 'boot'>(
  filter: LogsFilter,
  key: K,
  value: string | number
): LogsFilter {
  const rest = (filter[key] as (string | number)[] | undefined)?.filter((v) => v !== value) ?? []
  return rest.length === 0 ? without(filter, key) : { ...filter, [key]: rest }
}

// "This boot" for `current`, else the ID's first eight characters.
export function bootLabel(boot: string): string {
  return boot === 'current' ? 'This boot' : `Boot ${boot.replaceAll('-', '').slice(0, 8)}`
}

// The advanced filters in use, one chip per value (device text stays plain text: labels are
// rendered as text).
export function filterChips(filter: LogsFilter): FilterChipInfo[] {
  const chips: FilterChipInfo[] = []
  for (const [key, label] of [
    ['pid', 'PID'],
    ['tid', 'TID'],
    ['tag', 'Tag'],
    ['identity', 'Identity'],
    ['facility', 'Facility']
  ] as const) {
    for (const value of filter[key] ?? []) {
      chips.push({
        id: `${key}:${value}`,
        label: `${label} ${value}`,
        remove: (f) => withoutValue(f, key, value)
      })
    }
  }
  for (const value of filter.boot ?? []) {
    chips.push({
      id: `boot:${value}`,
      label: bootLabel(value),
      remove: (f) => withoutValue(f, 'boot', value)
    })
  }
  return chips
}

type RuleField = 'level' | 'rate' | 'mute'

// The process rules in use, one chip per muted process, level and limit.
export function ruleChips(filter: LogsFilter): FilterChipInfo[] {
  const chips: FilterChipInfo[] = []
  for (const rule of filter.processRules ?? []) {
    const id = rule.identity
    if (rule.mute) {
      chips.push({
        id: `mute:${id}`,
        label: `Muted ${id}`,
        remove: (f) => dropRuleField(f, id, 'mute')
      })
    }
    if (rule.level !== undefined) {
      chips.push({
        id: `level:${id}`,
        label: `${id} at ${rule.level.charAt(0).toUpperCase()}+`,
        remove: (f) => dropRuleField(f, id, 'level')
      })
    }
    if (rule.rate !== undefined) {
      chips.push({
        id: `rate:${id}`,
        label: `${id} limited to ${rule.rate}/s`,
        remove: (f) => dropRuleField(f, id, 'rate')
      })
    }
  }
  return chips
}

function dropRuleField(filter: LogsFilter, identity: string, field: RuleField): LogsFilter {
  const rules = (filter.processRules ?? []).flatMap((rule) => {
    if (rule.identity !== identity) return [rule]
    const rest = { ...rule }
    delete rest[field]
    return rest.level === undefined && rest.rate === undefined && rest.mute !== true ? [] : [rest]
  })
  return rules.length === 0 ? without(filter, 'processRules') : { ...filter, processRules: rules }
}

// The filter with one process's rule field set (a later change replaces the earlier one for the
// same process and field, as core merges rules).
export function withRule(
  filter: LogsFilter,
  identity: string,
  patch: { level?: string; rate?: number; mute?: true }
): LogsFilter {
  const rules = filter.processRules ?? []
  const at = rules.findIndex((rule) => rule.identity === identity)
  const next = [...rules]
  if (at === -1) next.push({ identity, ...patch })
  else next[at] = { ...rules[at], identity, ...patch }
  return { ...filter, processRules: next }
}
