import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { isOvdError, OvdError, toErrorJson, type ErrorJson } from '../errors/ovdError.js'
import { writeJsonAtomic } from '../state/atomicJson.js'
import { compileLogFilter, type LogFilterInput } from './logFilter.js'
import { logPresetKeys, resolvePreset, type SavedLogFilter } from './logPresets.js'

// Saved log filters (ADR 0026): `log-filters.json` in the host state directory, global, not per
// device. Everything read back is untrusted, like any file on disk.

export const MAX_SAVED_FILTERS = 50
export const MAX_FILTER_NAME_CHARS = 40
// A file this big isn't ours: 50 filters are a few KB.
const MAX_FILE_BYTES = 1024 * 1024
const MAX_TEXT = 4_096
const MAX_ITEMS = 100

const NAME = /^[a-z0-9][a-z0-9-]*$/

// Throws INVALID_LOG_FILTER_NAME unless `name` is 1-40 characters of `[a-z0-9-]` starting with a
// letter or a digit, and not the key of a built-in preset.
export function assertFilterName(name: unknown): string {
  if (typeof name !== 'string' || name.length === 0 || name.length > MAX_FILTER_NAME_CHARS) {
    throw badName(`A filter name needs 1–${MAX_FILTER_NAME_CHARS} characters`)
  }
  if (!NAME.test(name)) {
    throw badName(
      `${JSON.stringify(name.slice(0, 64))} isn’t a valid filter name`,
      'Use lower-case letters, digits and hyphens, starting with a letter or a digit'
    )
  }
  if (logPresetKeys().includes(name)) {
    throw badName(
      `${name} is the name of a built-in preset`,
      `Choose another name: ${logPresetKeys().join(', ')} are reserved`
    )
  }
  return name
}

function validName(name: string): boolean {
  return name.length >= 1 && name.length <= MAX_FILTER_NAME_CHARS && NAME.test(name)
}

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_CHAR = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/

// A stored name that fails the rule, made safe to print: controls escaped, bounded.
function displayName(name: string): string {
  const shown = Array.from(name)
    .slice(0, MAX_FILTER_NAME_CHARS)
    .map((char) =>
      UNSAFE_CHAR.test(char)
        ? `\\u${(char.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`
        : char
    )
    .join('')
  return Array.from(shown).slice(0, MAX_FILTER_NAME_CHARS).join('')
}

function badName(message: string, hint = 'Use 1–40 characters of a-z, 0-9 and -'): OvdError {
  return new OvdError('INVALID_LOG_FILTER_NAME', message, hint)
}

const text = z.string().max(MAX_TEXT)
const texts = z.array(text).max(MAX_ITEMS)
const ruleSchema = z.strictObject({
  identity: text,
  level: text.optional(),
  rate: z.union([z.number(), text]).optional(),
  mute: z.boolean().optional()
})

// The fields of a saved filter. Strict on purpose: `since`, `until` and `boot` are bound to a
// time or a boot (ADR 0026), and a field a newer OVD wrote is unknown to this one, so the
// entry reads as invalid rather than losing it silently.
const filterSchema = z.strictObject({
  app: text.optional(),
  system: z.boolean().optional(),
  level: text.optional(),
  search: z.string().max(MAX_TEXT).optional(),
  regex: z.boolean().optional(),
  appsOnly: z.boolean().optional(),
  lifecycle: z.boolean().optional(),
  pid: z
    .array(z.union([z.number(), text]))
    .max(MAX_ITEMS)
    .optional(),
  tid: z
    .array(z.union([z.number(), text]))
    .max(MAX_ITEMS)
    .optional(),
  tag: texts.optional(),
  identity: texts.optional(),
  facility: texts.optional(),
  processRules: z.array(ruleSchema).max(MAX_ITEMS).optional()
})

const NOT_SAVABLE = ['since', 'until', 'boot'] as const

function invalidFilter(message: string, hint: string): OvdError {
  return new OvdError('INVALID_LOG_FILTER', message, hint)
}

// A filter as it is stored: the known fields that are set, validated and compiled once (so an
// unsafe regex or a bad level is refused here, as on load).
function checkFilter(raw: unknown, now: Date): LogFilterInput {
  if (typeof raw === 'object' && raw !== null) {
    for (const key of NOT_SAVABLE) {
      if ((raw as Record<string, unknown>)[key] !== undefined) {
        throw invalidFilter(
          `A saved filter can’t hold ${key}`,
          'since, until and a boot ID are bound to a time or one boot; pass them when you use the filter'
        )
      }
    }
  }
  const parsed = filterSchema.safeParse(raw)
  if (!parsed.success) {
    // A fixed message: zod's text and path can echo what the file holds (a key name, a value).
    throw invalidFilter(
      'The saved filter isn’t valid (unknown or invalid field)',
      'Re-save it with ovd logs filter save, or delete it'
    )
  }
  const filter: LogFilterInput = {}
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) Object.assign(filter, { [key]: value })
  }
  compileLogFilter(filter, now)
  return filter
}

const fileSchema = z.object({
  version: z.literal(1),
  filters: z.array(z.object({ name: z.string().max(MAX_TEXT), filter: z.unknown() }))
})

interface RawEntry {
  name: string
  filter: unknown
}

// One entry of `list()`. An invalid one has no usable filter: it shows `{}`, never the stored
// value, and can still be removed.
export type SavedFilterItem =
  | { name: string; filter: LogFilterInput; valid: true }
  | { name: string; filter: LogFilterInput; valid: false; error: ErrorJson }

export interface SaveFilterOptions {
  // Replace a saved filter of the same name.
  force?: boolean
}

export interface SavedFilters {
  list(): Promise<SavedFilterItem[]>
  // Stores `input` under `name`; returns what was stored.
  save(name: string, input: LogFilterInput, opts?: SaveFilterOptions): Promise<SavedLogFilter>
  remove(name: string): Promise<{ name: string }>
  // The valid saved filters, for `resolvePreset`.
  valid(): Promise<SavedLogFilter[]>
  // A built-in preset key or a saved name, with `overrides` over it (F17, F18). A saved filter
  // that is invalid is INVALID_LOG_FILTER.
  resolve(name: string, overrides?: LogFilterInput): Promise<LogFilterInput>
}

export function createSavedFilters(opts: { home: string; now?: () => Date }): SavedFilters {
  const file = join(opts.home, 'log-filters.json')
  const now = opts.now ?? (() => new Date())

  const unreadable = (why: string) =>
    new OvdError(
      'LOG_FILTERS_UNREADABLE',
      `Couldn’t read the saved filters in ${file} (${why})`,
      'Fix or remove the file; OVD doesn’t replace it, so your filters aren’t lost'
    )

  async function readRaw(): Promise<RawEntry[]> {
    // One handle for the checks and the read, and no symlink followed: nothing can swap the file
    // between the check and the read.
    let body: string
    try {
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const info = await handle.stat()
        if (!info.isFile()) throw unreadable('not a regular file')
        if (info.size > MAX_FILE_BYTES) throw unreadable('too large')
        body = await handle.readFile('utf8')
      } finally {
        await handle.close()
      }
    } catch (error) {
      if (error instanceof OvdError) throw error
      if (isNotFound(error)) return []
      throw unreadable(codeOf(error))
    }
    let json: unknown
    try {
      json = JSON.parse(body)
    } catch {
      throw unreadable('not JSON')
    }
    const parsed = fileSchema.safeParse(json)
    if (!parsed.success) throw unreadable('unknown format or version')
    return parsed.data.filters
  }

  function judge(entry: RawEntry): SavedFilterItem {
    if (!validName(entry.name)) {
      return {
        name: displayName(entry.name),
        filter: {},
        valid: false,
        error: toErrorJson(
          invalidFilter(
            'The saved filter has an invalid name',
            'Delete it with ovd logs filter rm and save it again'
          )
        )
      }
    }
    try {
      return { name: entry.name, filter: checkFilter(entry.filter, now()), valid: true }
    } catch (error) {
      const failure = isOvdError(error)
        ? error
        : invalidFilter('The saved filter isn’t valid', 'Re-save it, or delete it')
      return { name: entry.name, filter: {}, valid: false, error: toErrorJson(failure) }
    }
  }

  const write = (entries: RawEntry[]) => writeJsonAtomic(file, { version: 1, filters: entries })

  async function validEntries(): Promise<SavedLogFilter[]> {
    const items = (await readRaw()).map(judge)
    return items.flatMap((item) => (item.valid ? [{ name: item.name, filter: item.filter }] : []))
  }

  return {
    async list() {
      return (await readRaw()).map(judge)
    },

    valid: validEntries,

    async save(rawName, input, saveOpts = {}) {
      const name = assertFilterName(rawName)
      const filter = checkFilter(input, now())
      const entries = await readRaw()
      const at = entries.findIndex((entry) => entry.name === name)
      if (at >= 0 && saveOpts.force !== true) {
        throw new OvdError(
          'LOG_FILTER_EXISTS',
          `A filter named ${name} already exists`,
          'Pass --force to replace it, or choose another name'
        )
      }
      if (at < 0 && entries.length >= MAX_SAVED_FILTERS) {
        throw new OvdError(
          'LOG_FILTER_EXISTS',
          `OVD keeps at most ${MAX_SAVED_FILTERS} saved filters`,
          'Delete one with ovd logs filter rm <name> first'
        )
      }
      const next = [...entries]
      if (at >= 0) next[at] = { name, filter }
      else next.push({ name, filter })
      await write(next)
      return { name, filter }
    },

    async remove(name) {
      const entries = await readRaw()
      const kept = entries.filter((entry) => entry.name !== name)
      if (kept.length === entries.length) {
        throw new OvdError(
          'UNKNOWN_LOG_PRESET',
          `No saved filter named ${JSON.stringify(name.slice(0, 64))}`,
          'List them with ovd logs filter list'
        )
      }
      await write(kept)
      return { name }
    },

    async resolve(name, overrides = {}) {
      // Built-ins first: a saved entry never shadows one, and they need no file.
      if (logPresetKeys().includes(name)) return resolvePreset(name, [], overrides)
      const items = (await readRaw()).map(judge)
      const found = items.find((item) => item.name === name)
      if (found && !found.valid) {
        throw new OvdError(
          'INVALID_LOG_FILTER',
          `The saved filter ${JSON.stringify(name.slice(0, 64))} isn’t valid: ${found.error.message}`,
          'Delete it with ovd logs filter rm and save it again'
        )
      }
      return resolvePreset(
        name,
        items.flatMap((item) => (item.valid ? [{ name: item.name, filter: item.filter }] : [])),
        overrides
      )
    }
  }
}

function isNotFound(error: unknown): boolean {
  return codeOf(error) === 'ENOENT'
}

function codeOf(error: unknown): string {
  if (error instanceof Error && 'code' in error) return String(error.code)
  return error instanceof Error ? error.message : String(error)
}
