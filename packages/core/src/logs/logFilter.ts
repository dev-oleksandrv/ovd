import { assertAppId } from '../deviceApps/appId.js'
import { OvdError } from '../errors/ovdError.js'
import { atLeast, levelLongName, parseLevelName } from './logLevel.js'
import { parseLogTime } from './logTime.js'
import type { LogEntry, LogLevel } from './types.js'

// What a surface passes, as typed by the user.
export interface LogFilterInput {
  app?: string
  system?: boolean
  level?: string
  since?: string
  until?: string
  search?: string
  regex?: boolean
}

export interface LogFilter {
  matches(entry: LogEntry): boolean
  // Epoch ms. `until` isn't part of `matches`: the session ends there.
  since?: number
  until?: number
  // What the activity log records.
  args: Record<string, string>
}

// A package-ID-shaped identity (at least one dot) is an app; anything else, or none, is the
// system.
const APP_IDENTITY = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)+$/

export function isAppIdentity(identity: string | null): boolean {
  return identity !== null && APP_IDENTITY.test(identity)
}

// A user regex can backtrack badly on a long line and block the log view, so it only sees the
// start of each message and tag. Plain-text search sees the whole text.
export const REGEX_SLICE_CHARS = 4_096

// Validates everything before any SDK call: a bad filter is a usage error.
export function compileLogFilter(input: LogFilterInput, now: Date): LogFilter {
  const args: Record<string, string> = {}
  const app = input.app === undefined ? undefined : assertAppId(input.app, { from: 'argument' })
  if (app !== undefined && input.system) {
    throw new OvdError(
      'INVALID_LOG_FILTER',
      '--app and --system can’t be combined',
      'Pass --app <id> for one app, or --system for everything else'
    )
  }
  if (app !== undefined) args.app = app
  if (input.system) args.system = 'true'
  let level: LogLevel = 'V'
  if (input.level !== undefined) {
    level = parseLevelName(input.level)
    args.level = levelLongName(level)
  }
  const since = input.since === undefined ? undefined : parseLogTime(input.since, now, 'since')
  const until = input.until === undefined ? undefined : parseLogTime(input.until, now, 'until')
  if (since && until && until.getTime() <= since.getTime()) {
    throw new OvdError(
      'INVALID_LOG_FILTER',
      '--until must be after --since',
      'Pass an --until time later than --since'
    )
  }
  if (since) args.since = since.toISOString()
  if (until) args.until = until.toISOString()
  const search = input.search === undefined || input.search === '' ? undefined : input.search
  let test: ((text: string) => boolean) | undefined
  if (search !== undefined) {
    args.grep = search
    if (input.regex) {
      args.regex = 'true'
      let pattern: RegExp
      try {
        pattern = new RegExp(search, 'i')
      } catch (error) {
        throw new OvdError(
          'INVALID_LOG_FILTER',
          `--grep ${JSON.stringify(search)} isn’t a valid regular expression: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'Fix the expression, or drop --regex to search for the text as is'
        )
      }
      test = (text) =>
        pattern.test(text.length > REGEX_SLICE_CHARS ? text.slice(0, REGEX_SLICE_CHARS) : text)
    } else {
      const needle = search.toLowerCase()
      test = (text) => text.toLowerCase().includes(needle)
    }
  }
  const sinceMs = since?.getTime()
  return {
    matches(entry) {
      if (app !== undefined && entry.process !== app) return false
      if (input.system && isAppIdentity(entry.process)) return false
      if (!atLeast(entry.level, level)) return false
      if (sinceMs !== undefined && Date.parse(entry.time) < sinceMs) return false
      if (test && !test(entry.message) && !test(entry.tag)) return false
      return true
    },
    ...(sinceMs === undefined ? {} : { since: sinceMs }),
    ...(until ? { until: until.getTime() } : {}),
    args
  }
}
