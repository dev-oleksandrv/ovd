import { OvdError } from '../errors/ovdError.js'
import type { LogFilterInput } from './logFilter.js'

export interface LogPreset {
  // The name `--preset` takes.
  key: string
  label: string
  filter: LogFilterInput
}

// A saved filter (`log-filters.json`), as `resolvePreset` sees it.
export interface SavedLogFilter {
  name: string
  filter: LogFilterInput
}

// Case-insensitive word lists, matched on the message or the tag (F15). The words come from
// the recorded lines (F16); a word is matched whole (`\b`), so `ssl` doesn't light up `LcmAppControlOpsSlimImpl`.
const NETWORK_WORDS = [
  'http',
  'https',
  'fetch',
  'xhr',
  'XMLHttpRequest',
  'websocket',
  'socket',
  'dns',
  'network',
  'connectivity',
  'wifi',
  'ethernet',
  'tls',
  'ssl',
  // `timeout=0` is a setting in a native line, not a network timeout.
  'timeout(?!=)'
]
// One definition for both surfaces (F15). Frozen: a surface copies what it edits.
const PRESETS: readonly LogPreset[] = Object.freeze([
  { key: 'all', label: 'All', filter: {} },
  {
    key: 'app-errors',
    label: 'App errors only',
    filter: { level: 'error', appsOnly: true }
  },
  {
    key: 'network',
    label: 'Network',
    filter: { search: `\\b(?:${NETWORK_WORDS.join('|')})\\b`, regex: true }
  },
  {
    key: 'lifecycle',
    label: 'Lifecycle',
    filter: { lifecycle: true }
  }
])

// The built-in presets, in display order, as copies.
export function logPresets(): LogPreset[] {
  return PRESETS.map((preset) => ({ ...preset, filter: { ...preset.filter } }))
}

export function logPresetKeys(): string[] {
  return PRESETS.map((preset) => preset.key)
}

// The filter groups an explicit field replaces together: `--app` and `--system` and apps-only
// are one choice about who logs. The search text and `--regex` are not a group: each replaces
// only itself (F18), so `--regex` alone keeps the preset's pattern and reads it as one.
const GROUPS: readonly (readonly (keyof LogFilterInput)[])[] = [['app', 'system', 'appsOnly']]

// A preset (or saved filter) as the base, and the explicit fields over it (D5, F18): a field
// the caller gave replaces the base's, and an array replaces the base's array whole.
export function mergeLogFilter(base: LogFilterInput, overrides: LogFilterInput): LogFilterInput {
  const merged: Record<string, unknown> = { ...base }
  const given = (key: keyof LogFilterInput) => overrides[key] !== undefined
  for (const group of GROUPS) {
    if (!group.some(given)) continue
    for (const key of group) delete merged[key]
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) merged[key] = value
  }
  return merged as LogFilterInput
}

// The filter a preset key or a saved filter name stands for, with `overrides` over it. The
// built-in keys win over a saved name (they're reserved, F21). UNKNOWN_LOG_PRESET lists the
// names that exist.
export function resolvePreset(
  name: string,
  saved: readonly SavedLogFilter[] = [],
  overrides: LogFilterInput = {}
): LogFilterInput {
  const builtin = PRESETS.find((preset) => preset.key === name)
  const found = builtin ?? saved.find((filter) => filter.name === name)
  if (found === undefined) {
    const names = [...logPresetKeys(), ...saved.map((filter) => filter.name)]
    throw new OvdError(
      'UNKNOWN_LOG_PRESET',
      `No log preset or saved filter named ${JSON.stringify(name.slice(0, 64))}`,
      `Use one of ${names.join(', ')}`
    )
  }
  return mergeLogFilter(structuredClone(found.filter), overrides)
}
