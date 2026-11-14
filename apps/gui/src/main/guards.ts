import { sep } from 'node:path'
import {
  assertFilterName,
  FILTER_TEXT_MAX,
  isRemoteKey,
  LOG_EXPORT_FORMATS,
  LOG_FACILITIES,
  logPresetKeys,
  MAX_FILTER_NAME_CHARS,
  MAX_PROCESS_RATE,
  type LogExportFormat,
  type ProcessRuleInput,
  type RemoteKey
} from '@ovd/core'
import type {
  CrashRef,
  LogsBundleRequest,
  LogsExportRequest,
  LogsFilter,
  SaveLogsFilterRequest
} from '../preload/api'

// IPC payloads come from the renderer; check them before they reach core.
export function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`${field} must be a non-empty string`)
  }
  return value
}

// An optional on/off switch (`force`): absent is off.
export function optionalFlag(value: unknown, field: string): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw new TypeError(`${field} must be a boolean`)
  return value
}

// A required on/off switch (the Logs footer toggle).
export function requireFlag(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${field} must be a boolean`)
  return value
}

const FILTER_FLAGS = ['system', 'regex', 'appsOnly', 'lifecycle'] as const
const FILTER_NUMBERS = ['pid', 'tid'] as const
const FILTER_WORDS = ['tag', 'identity'] as const

// Bounds on what the renderer sends: core validates for real, these keep a payload small.
const MAX_APP_CHARS = 256
const MAX_SEARCH_CHARS = 4_096
const MAX_ITEMS = 100
const LEVELS = ['v', 'verbose', 'd', 'debug', 'i', 'info', 'w', 'warn', 'e', 'error']
// A boot ID as core takes it: 32 hex characters (dashes allowed), or `current`.
const BOOT =
  /^(?:current|[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
// A saved filter's name (F21): the same rule core enforces.
const FILTER_NAME = /^[a-z0-9][a-z0-9-]*$/

function filterLevel(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`)
  if (!LEVELS.includes(value.toLowerCase())) {
    throw new TypeError(`${field} must be one of ${LEVELS.join(', ')}`)
  }
  return value
}

function boundedText(
  value: unknown,
  field: string,
  max: number,
  opts = { control: false }
): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`)
  if (Array.from(value).length > max) throw new TypeError(`${field} is too long`)
  if (opts.control && CONTROL.test(value)) {
    throw new TypeError(`${field} must not hold control characters`)
  }
  return value
}

function itemsOf(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`)
  if (value.length > MAX_ITEMS) throw new TypeError(`${field} has too many items`)
  return value
}

// One identity or tag: 1–FILTER_TEXT_MAX characters, no control characters.
function filterWord(value: unknown, field: string): string {
  const text = boundedText(value, field, FILTER_TEXT_MAX, { control: true })
  if (text === '') throw new TypeError(`${field} must not be empty`)
  return text
}

function processRules(value: unknown): ProcessRuleInput[] {
  return itemsOf(value, 'filter.processRules').map((raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new TypeError('a process rule must be an object')
    }
    const { identity, level, rate, mute, ...rest } = raw as Record<string, unknown>
    const extra = Object.keys(rest)[0]
    if (extra !== undefined) throw new TypeError(`${extra} is not a process rule field`)
    const rule: ProcessRuleInput = { identity: filterWord(identity, 'rule identity') }
    if (level !== undefined) rule.level = filterLevel(level, 'rule level')
    if (rate !== undefined) {
      if (
        typeof rate !== 'number' ||
        !Number.isInteger(rate) ||
        rate < 1 ||
        rate > MAX_PROCESS_RATE
      ) {
        throw new TypeError(`rule rate must be an integer from 1 to ${MAX_PROCESS_RATE}`)
      }
      rule.rate = rate
    }
    if (mute !== undefined) {
      if (typeof mute !== 'boolean') throw new TypeError('rule mute must be a boolean')
      if (mute) rule.mute = true
    }
    if (rule.level === undefined && rule.rate === undefined && rule.mute === undefined) {
      throw new TypeError('a process rule must set a level, a rate or mute')
    }
    return rule
  })
}

// The Logs screen's filter: only the known keys, each of its type and range when present.
export function logsFilter(value: unknown): LogsFilter {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('filter must be an object')
  }
  const record = value as Record<string, unknown>
  const filter: LogsFilter = {}
  for (const [key, field] of Object.entries(record)) {
    if (field === undefined) continue
    const name = `filter.${key}`
    if (key === 'app') {
      filter.app = boundedText(field, name, MAX_APP_CHARS)
    } else if (key === 'level') {
      filter.level = filterLevel(field, name)
    } else if (key === 'search') {
      filter.search = boundedText(field, name, MAX_SEARCH_CHARS)
    } else if ((FILTER_FLAGS as readonly string[]).includes(key)) {
      if (typeof field !== 'boolean') throw new TypeError(`${name} must be a boolean`)
      filter[key as (typeof FILTER_FLAGS)[number]] = field
    } else if ((FILTER_NUMBERS as readonly string[]).includes(key)) {
      filter[key as (typeof FILTER_NUMBERS)[number]] = itemsOf(field, name).map((item) => {
        if (typeof item !== 'number' || !Number.isSafeInteger(item) || item < 0) {
          throw new TypeError(`${name} must hold non-negative integers`)
        }
        return item
      })
    } else if ((FILTER_WORDS as readonly string[]).includes(key)) {
      filter[key as (typeof FILTER_WORDS)[number]] = itemsOf(field, name).map((item) =>
        filterWord(item, name)
      )
    } else if (key === 'facility') {
      filter.facility = itemsOf(field, name).map((item) => {
        if (typeof item !== 'string' || !(LOG_FACILITIES as readonly string[]).includes(item)) {
          throw new TypeError(`${name} must hold syslog facilities`)
        }
        return item
      })
    } else if (key === 'boot') {
      filter.boot = itemsOf(field, name).map((item) => {
        if (typeof item !== 'string' || !BOOT.test(item)) {
          throw new TypeError(`${name} must hold boot IDs or current`)
        }
        return item
      })
    } else if (key === 'processRules') {
      filter.processRules = processRules(field)
    } else {
      throw new TypeError(`${name} is not a log filter`)
    }
  }
  return filter
}

// A saved filter as the renderer's guard takes it. The CLI saves what its flags held: PIDs, TIDs
// and rates as digit strings, facilities in any case; core accepts those, `logsFilter` wants
// numbers and lower case. Done on main, where core's own rules (digits only, case-insensitive
// facility) are applied, then the result goes through `logsFilter` like any renderer filter.
export function normalizeSavedFilter(filter: unknown): LogsFilter {
  if (typeof filter !== 'object' || filter === null || Array.isArray(filter)) {
    throw new TypeError('filter must be an object')
  }
  const out: Record<string, unknown> = { ...(filter as Record<string, unknown>) }
  const numbers = (items: unknown): unknown =>
    Array.isArray(items)
      ? items.map((item) =>
          typeof item === 'string' && /^\d{1,15}$/.test(item) ? Number(item) : item
        )
      : items
  if (out.pid !== undefined) out.pid = numbers(out.pid)
  if (out.tid !== undefined) out.tid = numbers(out.tid)
  if (Array.isArray(out.facility)) {
    out.facility = out.facility.map((item) =>
      typeof item === 'string' ? item.toLowerCase() : item
    )
  }
  if (Array.isArray(out.processRules)) {
    out.processRules = out.processRules.map((rule: unknown) => {
      if (typeof rule !== 'object' || rule === null) return rule
      const { rate, ...rest } = rule as Record<string, unknown>
      return typeof rate === 'string' && /^\d{1,9}$/.test(rate)
        ? { ...rest, rate: Number(rate) }
        : rule
    })
  }
  return logsFilter(out)
}

// A saved filter's name as the renderer sends it to save: core's rule (F21), checked here too.
export function savedFilterName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > MAX_FILTER_NAME_CHARS ||
    !FILTER_NAME.test(value)
  ) {
    throw new TypeError(`name must be 1–${MAX_FILTER_NAME_CHARS} characters of a-z, 0-9 and -`)
  }
  return value
}

// A name to delete: bounded text only, since a file edited by hand can hold a name that breaks
// the save rule, and it must still be deletable.
export function savedFilterRef(value: unknown): string {
  const text = boundedText(value, 'name', 4 * MAX_FILTER_NAME_CHARS)
  if (text === '') throw new TypeError('name must not be empty')
  return text
}

// A preset label for the bundle manifest: a built-in key or a name core's rule accepts. Never
// free text, so nothing a renderer makes up reaches the manifest.
function presetLabel(value: unknown): string {
  if (typeof value === 'string' && logPresetKeys().includes(value)) return value
  try {
    return assertFilterName(value)
  } catch {
    throw new TypeError('preset must be a built-in preset or a valid saved filter name')
  }
}

// Save's request: a name, a filter and an optional `force`, nothing else.
export function saveLogsFilterRequest(value: unknown): SaveLogsFilterRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('save request must be an object')
  }
  const { name, filter, force, ...rest } = value as Record<string, unknown>
  const extra = Object.keys(rest)[0]
  if (extra !== undefined) throw new TypeError(`${extra} is not a save option`)
  return {
    name: savedFilterName(name),
    filter: logsFilter(filter),
    ...(optionalFlag(force, 'force') ? { force: true } : {})
  }
}

// An optional entry number (`throughSeq`): absent, or a non-negative integer.
export function optionalSeq(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError('throughSeq must be a non-negative integer')
  }
  return value
}

// Export's request: a known format and an optional `throughSeq`, nothing else.
export function logsExportRequest(value: unknown): LogsExportRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('export request must be an object')
  }
  const { format, throughSeq, ...rest } = value as Record<string, unknown>
  const extra = Object.keys(rest)[0]
  if (extra !== undefined) throw new TypeError(`${extra} is not an export option`)
  if (!(LOG_EXPORT_FORMATS as readonly unknown[]).includes(format)) {
    throw new TypeError(`format must be one of ${LOG_EXPORT_FORMATS.join(', ')}`)
  }
  const seq = optionalSeq(throughSeq)
  return { format: format as LogExportFormat, ...(seq === undefined ? {} : { throughSeq: seq }) }
}

// Bundle's request: an optional `throughSeq` (the pause), nothing else. Never a path: main's
// save dialog decides where the file goes.
export function logsBundleRequest(value: unknown): LogsBundleRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('bundle request must be an object')
  }
  const { throughSeq, preset, ...rest } = value as Record<string, unknown>
  const extra = Object.keys(rest)[0]
  if (extra !== undefined) throw new TypeError(`${extra} is not a bundle option`)
  const seq = optionalSeq(throughSeq)
  return {
    ...(seq === undefined ? {} : { throughSeq: seq }),
    ...(preset === undefined ? {} : { preset: presetLabel(preset) })
  }
}

// A remote key the pad or the keyboard sent (`down`, `play-pause`).
export function inputKey(value: unknown): RemoteKey {
  if (typeof value !== 'string' || !isRemoteKey(value))
    throw new TypeError('key is not a remote key')
  return value
}

// Core checks what a device can type (INVALID_TEXT); this only bounds the payload.
const MAX_INPUT_TEXT = 10_000

// A string from the renderer: a device ID, or the text to type (which may be empty, so core
// answers INVALID_TEXT for it).
export function inputText(
  value: unknown,
  field: string,
  opts: { allowEmpty?: boolean } = {}
): string {
  if (typeof value !== 'string' || (value === '' && !opts.allowEmpty)) {
    throw new TypeError(`${field} must be a${opts.allowEmpty ? '' : ' non-empty'} string`)
  }
  if (value.length > MAX_INPUT_TEXT) throw new TypeError(`${field} is too long`)
  return value
}

// A capture the renderer asks main to show in its folder: a `.png` whose real path (symlinks
// resolved) is inside the captures folder's real path, so a renderer can't reveal anything else.
export async function capturePath(
  value: unknown,
  capturesDir: string,
  realpath: (path: string) => Promise<string>
): Promise<string> {
  if (typeof value !== 'string' || value === '' || value.length > 4_096) {
    throw new TypeError('path must be a non-empty string')
  }
  const [real, dir] = await Promise.all([realpath(value), realpath(capturesDir)])
  if (!real.startsWith(dir.endsWith(sep) ? dir : dir + sep) || !/\.png$/i.test(real)) {
    throw new TypeError('path is not a capture')
  }
  return real
}

// The one thing the renderer says about a crash: the device it shows and the report's vault
// index. Anything else (above all a path) is refused, so no handler can be handed a file.
export function crashRef(value: unknown): CrashRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('crash must be an object')
  }
  const { device, id, ...rest } = value as Record<string, unknown>
  const extra = Object.keys(rest)[0]
  if (extra !== undefined) throw new TypeError(`${extra} is not a crash field`)
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) {
    throw new TypeError('id must be a non-negative integer')
  }
  return { device: requireText(device, 'device'), id }
}

// A crash report main is about to copy or show: an `.acr` whose real path (symlinks resolved)
// is inside the crashes folder's real path. The path comes from main's own record of a pull,
// never from the renderer; this is the second check.
export async function crashReportPath(
  value: unknown,
  crashesDir: string,
  realpath: (path: string) => Promise<string>
): Promise<string> {
  if (typeof value !== 'string' || value === '' || value.length > 4_096) {
    throw new TypeError('path must be a non-empty string')
  }
  const [real, dir] = await Promise.all([realpath(value), realpath(crashesDir)])
  if (!real.startsWith(dir.endsWith(sep) ? dir : dir + sep) || !/\.acr$/i.test(real)) {
    throw new TypeError('path is not a crash report')
  }
  return real
}
