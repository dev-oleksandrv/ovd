import { OvdError } from '../errors/ovdError.js'
import type { LogLevel } from './types.js'

type EntryLevel = Exclude<LogLevel, 'V'>

// The eight syslog priorities `loggingctl` prints (ARCHITECTURE §8).
const BY_PRIORITY: Record<string, EntryLevel> = {
  emerg: 'E',
  alert: 'E',
  crit: 'E',
  err: 'E',
  warning: 'W',
  notice: 'I',
  info: 'I',
  debug: 'D'
}

// An unknown priority counts as I; the entry keeps the priority as printed.
export function levelOf(priority: string): EntryLevel {
  return BY_PRIORITY[priority] ?? 'I'
}

const BY_NAME: Record<string, LogLevel> = {
  v: 'V',
  verbose: 'V',
  d: 'D',
  debug: 'D',
  i: 'I',
  info: 'I',
  w: 'W',
  warn: 'W',
  e: 'E',
  error: 'E'
}

const LONG_NAME: Record<LogLevel, string> = {
  V: 'verbose',
  D: 'debug',
  I: 'info',
  W: 'warn',
  E: 'error'
}

export function parseLevelName(text: string): LogLevel {
  const level = BY_NAME[text.toLowerCase()]
  if (level) return level
  throw new OvdError(
    'INVALID_LOG_FILTER',
    `--level ${JSON.stringify(text)} isn’t a log level`,
    'Use one of verbose, debug, info, warn, error (or v, d, i, w, e)'
  )
}

export function levelLongName(level: LogLevel): string {
  return LONG_NAME[level]
}

const RANK: Record<LogLevel, number> = { V: 0, D: 1, I: 2, W: 3, E: 4 }

// V is the lowest: a V minimum keeps everything.
export function atLeast(level: LogLevel, min: LogLevel): boolean {
  return RANK[level] >= RANK[min]
}
