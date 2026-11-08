import { OvdError } from '../errors/ovdError.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DEVICE_TIME = /^([A-Z][a-z]{2}) {1,2}(\d{1,2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/
const DAY_MS = 24 * 60 * 60 * 1000

// The device prints UTC with no year (`Nov 08 07:27:00.257342`, ARCHITECTURE §8): take the
// latest year (`now`'s UTC year, the one after or the one before) that puts the entry no more
// than a day ahead of `now`. So a backlog read just after New Year stays in the old year, and a
// device clock a little ahead at New Year's Eve is already in the new one. Microseconds are
// truncated to milliseconds.
export function deviceInstant(deviceTime: string, now: Date): Date | undefined {
  const m = DEVICE_TIME.exec(deviceTime)
  if (!m) return undefined
  const [, mon = '', day = '', hh = '', mm = '', ss = '', frac = ''] = m
  const month = MONTHS.indexOf(mon)
  if (month === -1) return undefined
  const ms = Number(frac.padEnd(6, '0').slice(0, 3))
  const at = (year: number) =>
    Date.UTC(year, month, Number(day), Number(hh), Number(mm), Number(ss), ms)
  const year = now.getUTCFullYear()
  const instant = [year + 1, year].map(at).find((t) => t - now.getTime() <= DAY_MS) ?? at(year - 1)
  const date = new Date(instant)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/
const CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/
const AGO = /^(\d+)([smh])$/
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000 }

// `--since` and `--until`: an ISO 8601 date-time (no zone = host local time), a time of day
// today in host local time, or a duration before `now`.
export function parseLogTime(text: string, now: Date, flag: 'since' | 'until'): Date {
  const value = text.trim()
  if (ISO.test(value)) {
    const date = new Date(value.replace(' ', 'T'))
    if (!Number.isNaN(date.getTime())) return date
  }
  const clock = CLOCK.exec(value)
  if (clock) {
    const [, hh = '', mm = '', ss = '0'] = clock
    const h = Number(hh)
    const m = Number(mm)
    const s = Number(ss)
    if (h < 24 && m < 60 && s < 60) {
      const date = new Date(now)
      date.setHours(h, m, s, 0)
      return date
    }
  }
  const ago = AGO.exec(value)
  if (ago) {
    const [, n = '', unit = 's'] = ago
    return new Date(now.getTime() - Number(n) * UNIT_MS[unit as keyof typeof UNIT_MS])
  }
  throw new OvdError(
    'INVALID_LOG_FILTER',
    `--${flag} ${JSON.stringify(text)} isn’t a time`,
    'Use an ISO date-time (2026-11-08T07:27:00Z), a time of day today (07:27 or 07:27:00), or a duration ago (30s, 5m, 2h)'
  )
}
