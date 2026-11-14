import { OvdError } from '../errors/ovdError.js'
import { parseLevelName } from './logLevel.js'
import { ovdEntry } from './ovdEvents.js'
import type { LogEntry, LogLevel } from './types.js'

// What a surface passes for one process: `--process-level`, `--process-rate` and `--mute`
// (F27), or a saved filter's rule. At least one of the three must be set.
export interface ProcessRuleInput {
  identity: string
  // `V|D|I|W|E` or a level name: this process shows its lines at or above it, instead of the
  // global level.
  level?: string
  // Lines of this process shown per second of device time (1..MAX_PROCESS_RATE).
  rate?: number | string
  // Hide this process. Wins over the other two.
  mute?: boolean
}

export interface ProcessRule {
  identity: string
  level?: LogLevel
  rate?: number
  mute?: boolean
}

export const MAX_PROCESS_RATE = 10_000
export const FILTER_TEXT_MAX = 128

// C0 controls, DEL, C1 controls and the bidi formatting controls: none belongs in a tag or an
// identity a user types, and none may reach a saved filter or an echoed command.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROLS = /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/

// A tag or an identity as typed (`--tag`, `--identity`, a rule's identity): 1..128 characters
// and no control characters. Its own check, not `assertAppId`: system identities
// (`lcm_service`) and tags (`resmgr-app-registry`) aren't package IDs.
export function assertFilterText(flag: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(`${flag} needs a value`, `Pass a non-empty ${flag} value`)
  }
  if (CONTROLS.test(value)) {
    throw invalid(
      `${flag} ${JSON.stringify(value)} has a control character`,
      `Use plain text in ${flag}`
    )
  }
  if (Array.from(value).length > FILTER_TEXT_MAX) {
    throw invalid(
      `${flag} is longer than ${FILTER_TEXT_MAX} characters`,
      `Pass at most ${FILTER_TEXT_MAX} characters`
    )
  }
  return value
}

// Validates the rules and merges the ones for the same identity (later fields win, any mute
// stays). A rule that sets nothing is a mistake, not a no-op.
export function compileProcessRules(inputs: readonly ProcessRuleInput[]): ProcessRule[] {
  const rules = new Map<string, ProcessRule>()
  for (const input of inputs) {
    const identity = assertFilterText('a process rule’s identity', input.identity)
    const rule = rules.get(identity) ?? { identity }
    let sets = false
    if (input.level !== undefined) {
      rule.level = parseLevelName(input.level)
      sets = true
    }
    if (input.rate !== undefined) {
      rule.rate = parseRate(identity, input.rate)
      sets = true
    }
    if (input.mute === true) {
      rule.mute = true
      sets = true
    }
    if (!sets) {
      throw invalid(
        `The rule for ${JSON.stringify(identity)} sets nothing`,
        'Give it a level, a rate or mute'
      )
    }
    rules.set(identity, rule)
  }
  return [...rules.values()]
}

function parseRate(identity: string, value: number | string): number {
  const rate =
    typeof value === 'number' ? value : /^\d{1,9}$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isSafeInteger(rate) || rate < 1 || rate > MAX_PROCESS_RATE) {
    throw invalid(
      `The rate for ${JSON.stringify(identity)} must be a whole number from 1 to ${MAX_PROCESS_RATE}, not ${JSON.stringify(value)}`,
      'Pass the lines per second to show, such as --process-rate com.example.player=20'
    )
  }
  return rate
}

function invalid(message: string, hint: string): OvdError {
  return new OvdError('INVALID_LOG_FILTER', message, hint)
}

// What a rate limiter says about the entries it has seen, in order.
export interface RateLimiter {
  // Call first for every device entry, in stream order. The OVD lines for the seconds that
  // ended before this entry (one per process that had lines hidden in one).
  roll(entry: LogEntry): LogEntry[]
  // Call for an entry that would be shown, after `roll`: false when it is over the process's
  // rate for its second.
  admit(entry: LogEntry, rate: number): boolean
  // End of input: the OVD lines for the seconds still open.
  flush(): LogEntry[]
}

interface Bucket {
  second: string
  count: number
  hidden: number
}

// The device-time second of an entry, as `YYYY-MM-DDTHH:MM:SSZ`: the entry's instant is the
// device time, so the count never depends on when the host read the line.
export function secondOf(entry: LogEntry): string {
  return `${entry.time.slice(0, 19)}Z`
}

// Counts each process's lines per device-time second and says when one is over its rate.
// It reads nothing but the entries, in order, so a replay of the same entries gives the same
// answers (F30). A second that dropped lines gives one `rate-limited` OVD line, once the
// device time has moved past it, or at `flush`. A line older than the newest second seen
// counts in the newest second, so the clock never runs backwards.
export function createRateLimiter(): RateLimiter {
  const buckets = new Map<string, Bucket>()
  // Identities with hidden lines, in the order they first hid one.
  const pending = new Set<string>()
  let newest = ''
  let last: LogEntry | undefined

  const lineFor = (identity: string, bucket: Bucket, at: LogEntry): LogEntry => {
    const line = ovdEntry(
      { kind: 'rate-limited', process: identity, hidden: bucket.hidden, second: bucket.second },
      at.time,
      at.seq
    )
    bucket.hidden = 0
    return line
  }

  const clock = (entry: LogEntry): string => {
    const second = secondOf(entry)
    if (second > newest) newest = second
    return newest
  }

  return {
    roll(entry) {
      last = entry
      const second = clock(entry)
      const lines: LogEntry[] = []
      for (const identity of pending) {
        const bucket = buckets.get(identity)
        if (bucket === undefined || bucket.second >= second) continue
        lines.push(lineFor(identity, bucket, entry))
        pending.delete(identity)
      }
      return lines
    },
    admit(entry, rate) {
      const identity = entry.process
      if (identity === null) return true
      const second = clock(entry)
      let bucket = buckets.get(identity)
      if (bucket === undefined || bucket.second !== second) {
        bucket = { second, count: 0, hidden: 0 }
        buckets.set(identity, bucket)
      }
      bucket.count++
      if (bucket.count <= rate) return true
      bucket.hidden++
      pending.add(identity)
      return false
    },
    flush() {
      const at = last
      if (at === undefined) return []
      const lines: LogEntry[] = []
      for (const identity of pending) {
        const bucket = buckets.get(identity)
        if (bucket !== undefined && bucket.hidden > 0) lines.push(lineFor(identity, bucket, at))
      }
      pending.clear()
      return lines
    }
  }
}
