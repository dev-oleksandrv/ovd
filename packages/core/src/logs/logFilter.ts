import { assertAppId } from '../deviceApps/appId.js'
import { OvdError } from '../errors/ovdError.js'
import { normalizeBootFilter } from './bootId.js'
import { atLeast, levelLongName, parseLevelName } from './logLevel.js'
import { parseLogTime } from './logTime.js'
import {
  assertFilterText,
  compileProcessRules,
  createRateLimiter,
  type ProcessRule,
  type ProcessRuleInput
} from './processRules.js'
import { assertSafeRegex } from './safeRegex.js'
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
  // Only entries of an app identity (a package-ID-shaped one): what the `app-errors` preset
  // needs. `app` implies it; it can't combine with `system`.
  appsOnly?: boolean
  // Only the app lifecycle lines (the `lifecycle` preset, F15): entries of the identity
  // `lcm_service`, or whose message holds a lifecycle word. One predicate rather than a search
  // pattern, because fields combine with AND and the identity is an OR branch.
  lifecycle?: boolean
  // The advanced fields, each repeatable: values of one field combine with OR, different fields
  // (and the fields above) with AND. All are matched on the host, never sent to the device.
  // Process and thread IDs: non-negative integers, as numbers or digit strings.
  pid?: (number | string)[]
  tid?: (number | string)[]
  // Exact, case-sensitive tags and syslog identities (any identity, system ones too).
  tag?: string[]
  identity?: string[]
  // A syslog facility from LOG_FACILITIES.
  facility?: string[]
  // A boot ID (32 hex characters, dashes accepted) or `current`: the boot of the stream now
  // running. Needs the boot ID the session reads at each stream start (`LogStartOptions.tagBoot`).
  boot?: string[]
  // Per-process level, rate limit and mute (F27), applied in order by `evaluator()`.
  processRules?: ProcessRuleInput[]
}

// The syslog facilities `loggingctl` prints (ARCHITECTURE §8).
export const LOG_FACILITIES = [
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
] as const

// What the filter needs from the session that a plain input can't say.
export interface LogFilterContext {
  // The boot ID of the stream now running (what `--boot current` means), undefined while
  // unknown.
  currentBoot?: () => string | undefined
  // The package IDs of the side-loaded apps on the target (F15: the `app-errors` preset is the
  // developer's own apps, not the installed system ones). A session that gives this hook fails
  // closed: while it returns undefined (the listing failed or isn't read yet), `appsOnly`
  // matches no line, because the syntax check would let installed system apps through. Without
  // the hook (a filter compiled on its own) the package-ID syntax check decides.
  sideloaded?: () => ReadonlySet<string> | undefined
}

// The verdict for one entry, from an evaluator.
export interface LogVerdict {
  shown: boolean
  // OVD lines derived by the filter that go right before this entry (the `rate-limited` lines
  // of the seconds that ended). They share the entry's `seq` and `time`.
  before: readonly LogEntry[]
}

// The filter applied to entries in stream order. Rate limits count lines, so the answer for an
// entry depends on the entries before it: one evaluator per pass over the entries, and a new
// one to re-filter (F30).
export interface LogEvaluator {
  next(entry: LogEntry): LogVerdict
  // End of input: the derived lines for seconds still open. Empty when nothing is pending.
  flush(): LogEntry[]
}

export interface LogFilter {
  // The filter without the rate limits (they need order): fine for one entry on its own.
  matches(entry: LogEntry): boolean
  // The full filter, rate limits included, for entries in order.
  evaluator(): LogEvaluator
  // Some field filters on the boot, so entries need the boot tag.
  usesBoot: boolean
  // ... and one of the values is `current`.
  usesCurrentBoot: boolean
  // `appsOnly` is set, so the entries are judged against the side-loaded apps.
  usesAppsOnly: boolean
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

// The lifecycle words of F15, whole words, in the message. `terminat` is a stem (terminate,
// terminated, termination).
const LIFECYCLE_WORDS =
  /\b(?:lifecycle state changed|app launch|terminat\w*|foreground|background)\b/i

function isLifecycle(entry: LogEntry): boolean {
  return entry.process === 'lcm_service' || LIFECYCLE_WORDS.test(entry.message)
}

// A user regex can backtrack badly on a long line and block the log view, so it only sees the
// start of each message and tag. Plain-text search sees the whole text.
export const REGEX_SLICE_CHARS = 4_096

// Validates everything before any SDK call: a bad filter is a usage error.
export function compileLogFilter(
  input: LogFilterInput,
  now: Date,
  ctx: LogFilterContext = {}
): LogFilter {
  const args: Record<string, string> = {}
  const app = input.app === undefined ? undefined : assertAppId(input.app, { from: 'argument' })
  if (app !== undefined && input.system) {
    throw new OvdError(
      'INVALID_LOG_FILTER',
      '--app and --system can’t be combined',
      'Pass --app <id> for one app, or --system for everything else'
    )
  }
  if (input.appsOnly && input.system) {
    throw new OvdError(
      'INVALID_LOG_FILTER',
      'Apps only and --system can’t be combined',
      'Pick apps or the system, not both'
    )
  }
  if (app !== undefined) args.app = app
  if (input.system) args.system = 'true'
  if (input.appsOnly) args['apps-only'] = 'true'
  if (input.lifecycle) args.lifecycle = 'true'
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
  const pids = numberSet('--pid', input.pid, 'a process ID such as 1234')
  const tids = numberSet('--tid', input.tid, 'a thread ID such as 1234')
  const tags = textSet('--tag', input.tag)
  const identities = textSet('--identity', input.identity)
  const facilities = facilitySet(input.facility)
  const boots = bootSet(input.boot)
  if (pids) args.pid = [...pids].join(',')
  if (tids) args.tid = [...tids].join(',')
  if (tags) args.tag = [...tags].join(',')
  if (identities) args.identity = [...identities].join(',')
  if (facilities) args.facility = [...facilities].join(',')
  if (boots) args.boot = [...boots].join(',')
  const rules = compileProcessRules(input.processRules ?? [])
  recordRules(args, rules)
  const byIdentity = new Map(rules.map((rule) => [rule.identity, rule]))
  const rates = new Map<string, number>()
  for (const rule of rules) if (rule.rate !== undefined) rates.set(rule.identity, rule.rate)
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
      // After the syntax check, so a typo gets the engine's own message. Every regex goes
      // through here: typed on the CLI or in the desktop, or read from a saved filter.
      assertSafeRegex(search)
      test = (text) =>
        pattern.test(text.length > REGEX_SLICE_CHARS ? text.slice(0, REGEX_SLICE_CHARS) : text)
    } else {
      const needle = search.toLowerCase()
      test = (text) => text.toLowerCase().includes(needle)
    }
  }
  const sinceMs = since?.getTime()
  const wantsCurrent = boots?.has('current') ?? false
  const currentBoot = ctx.currentBoot ?? (() => undefined)
  const isAppEntry = (identity: string | null): boolean => {
    if (ctx.sideloaded === undefined) return isAppIdentity(identity)
    const set = ctx.sideloaded()
    // Unknown set: fail closed (see LogFilterContext.sideloaded).
    return set !== undefined && identity !== null && set.has(identity)
  }
  const matchesBoot = (boot: string | undefined): boolean => {
    if (boots === undefined) return true
    if (boot === undefined) return false
    return boots.has(boot) || (wantsCurrent && boot === currentBoot())
  }

  const matches = (entry: LogEntry): boolean => {
    // OVD lines show whatever the filter: they explain what happened to the stream.
    if (entry.ovd !== undefined) return true
    const rule = entry.process === null ? undefined : byIdentity.get(entry.process)
    // Mute beats every other rule; a rule's level replaces the global one for its process.
    if (rule?.mute) return false
    if (app !== undefined && entry.process !== app) return false
    if (input.system && isAppIdentity(entry.process)) return false
    if (input.appsOnly && !isAppEntry(entry.process)) return false
    if (input.lifecycle && !isLifecycle(entry)) return false
    if (!atLeast(entry.level, rule?.level ?? level)) return false
    if (sinceMs !== undefined && Date.parse(entry.time) < sinceMs) return false
    if (pids && (entry.pid === null || !pids.has(entry.pid))) return false
    if (tids && (entry.tid === null || !tids.has(entry.tid))) return false
    if (tags && !tags.has(entry.tag)) return false
    if (identities && (entry.process === null || !identities.has(entry.process))) return false
    if (facilities && (entry.facility === null || !facilities.has(entry.facility))) return false
    if (!matchesBoot(entry.boot)) return false
    if (test && !test(entry.message) && !test(entry.tag)) return false
    return true
  }

  const NO_LINES: readonly LogEntry[] = []
  const evaluator = (): LogEvaluator => {
    // No rate rule: the filter needs no order, and nothing is derived.
    if (rates.size === 0) {
      return { next: (entry) => ({ shown: matches(entry), before: NO_LINES }), flush: () => [] }
    }
    const limiter = createRateLimiter()
    return {
      next(entry) {
        if (entry.ovd !== undefined) return { shown: true, before: NO_LINES }
        const before = limiter.roll(entry)
        if (!matches(entry)) return { shown: false, before }
        const rate = entry.process === null ? undefined : rates.get(entry.process)
        return { shown: rate === undefined || limiter.admit(entry, rate), before }
      },
      flush: () => limiter.flush()
    }
  }

  return {
    matches,
    evaluator,
    usesBoot: boots !== undefined,
    usesCurrentBoot: wantsCurrent,
    usesAppsOnly: input.appsOnly === true,
    ...(sinceMs === undefined ? {} : { since: sinceMs }),
    ...(until ? { until: until.getTime() } : {}),
    args
  }
}

function invalid(message: string, hint: string): OvdError {
  return new OvdError('INVALID_LOG_FILTER', message, hint)
}

// A field's values as a set, in the order given, or undefined when the field is absent or empty.
function valuesOf<T, R>(
  values: readonly T[] | undefined,
  one: (value: T) => R
): Set<R> | undefined {
  if (values === undefined || values.length === 0) return undefined
  return new Set(values.map(one))
}

function numberSet(
  flag: string,
  values: readonly (number | string)[] | undefined,
  example: string
) {
  return valuesOf(values, (value) => {
    const n =
      typeof value === 'number' ? value : /^\d{1,15}$/.test(value) ? Number(value) : Number.NaN
    if (!Number.isSafeInteger(n) || n < 0) {
      throw invalid(
        `${flag} ${JSON.stringify(value)} isn’t a non-negative whole number`,
        `Pass ${example}`
      )
    }
    return n
  })
}

function textSet(flag: string, values: readonly string[] | undefined) {
  return valuesOf(values, (value) => assertFilterText(flag, value))
}

function facilitySet(values: readonly string[] | undefined) {
  return valuesOf(values, (value) => {
    const facility = typeof value === 'string' ? value.toLowerCase() : ''
    if (!(LOG_FACILITIES as readonly string[]).includes(facility)) {
      throw invalid(
        `--facility ${JSON.stringify(value)} isn’t a syslog facility`,
        `Use one of ${LOG_FACILITIES.join(', ')}`
      )
    }
    return facility
  })
}

function bootSet(values: readonly string[] | undefined) {
  return valuesOf(values, (value) => {
    const boot = typeof value === 'string' ? normalizeBootFilter(value) : undefined
    if (boot === undefined) {
      throw invalid(
        `--boot ${JSON.stringify(value)} isn’t a boot ID or current`,
        'Pass current, or the 32 hex characters of a boot ID (dashes are fine)'
      )
    }
    return boot
  })
}

// What the activity log records: the rules as the flags that make them.
function recordRules(args: Record<string, string>, rules: readonly ProcessRule[]): void {
  const levels = rules.flatMap((r) => (r.level ? [`${r.identity}=${levelLongName(r.level)}`] : []))
  const rates = rules.flatMap((r) => (r.rate === undefined ? [] : [`${r.identity}=${r.rate}`]))
  const muted = rules.flatMap((r) => (r.mute ? [r.identity] : []))
  if (levels.length > 0) args['process-level'] = levels.join(',')
  if (rates.length > 0) args['process-rate'] = rates.join(',')
  if (muted.length > 0) args.mute = muted.join(',')
}
