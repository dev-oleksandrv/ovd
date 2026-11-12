import { isRemoteKey, LOG_EXPORT_FORMATS, type LogExportFormat, type RemoteKey } from '@ovd/core'
import type { LogsExportRequest, LogsFilter } from '../preload/api'

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

const FILTER_TEXT = ['app', 'level', 'search'] as const
const FILTER_FLAGS = ['system', 'regex'] as const

// The Logs screen's filter: only the known keys, each of its type when present.
export function logsFilter(value: unknown): LogsFilter {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('filter must be an object')
  }
  const record = value as Record<string, unknown>
  const filter: LogsFilter = {}
  for (const [key, field] of Object.entries(record)) {
    if (field === undefined) continue
    if ((FILTER_TEXT as readonly string[]).includes(key)) {
      if (typeof field !== 'string') throw new TypeError(`filter.${key} must be a string`)
      filter[key as (typeof FILTER_TEXT)[number]] = field
    } else if ((FILTER_FLAGS as readonly string[]).includes(key)) {
      if (typeof field !== 'boolean') throw new TypeError(`filter.${key} must be a boolean`)
      filter[key as (typeof FILTER_FLAGS)[number]] = field
    } else {
      throw new TypeError(`filter.${key} is not a log filter`)
    }
  }
  return filter
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
