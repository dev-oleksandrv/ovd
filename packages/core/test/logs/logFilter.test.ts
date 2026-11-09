import { describe, expect, test } from 'vitest'
import { createLogStreamParser } from '../../src/adapters/parseLogStream.js'
import {
  compileLogFilter,
  isAppIdentity,
  REGEX_SLICE_CHARS,
  type LogFilterInput
} from '../../src/logs/logFilter.js'
import type { LogEntry } from '../../src/logs/types.js'
import { fixture } from '../support/fixtures.js'

const NOW = new Date('2026-11-08T12:00:00Z')
const parser = createLogStreamParser({ now: () => NOW })
const ENTRIES = [...parser.push(fixture('0.24/loggingctl-log/stick-follow.txt')), ...parser.end()]
const PLAYER = 'com.example.player'

const kept = (input: LogFilterInput) => {
  const filter = compileLogFilter(input, NOW)
  return ENTRIES.filter((e) => filter.matches(e))
}

describe('compileLogFilter', () => {
  test('no filter keeps everything', () => {
    expect(kept({})).toHaveLength(ENTRIES.length)
  })

  test('--app keeps that app’s entries, continuation text included', () => {
    const entries = kept({ app: PLAYER })
    expect(entries.length).toBeGreaterThan(2)
    expect(entries.every((e) => e.process === PLAYER)).toBe(true)
    expect(entries.some((e) => e.message.includes('line three'))).toBe(true)
  })

  test('--app with --level error keeps the two error ticks', () => {
    expect(kept({ app: PLAYER, level: 'error' }).map((e) => e.message)).toEqual([
      '[KeplerScript-JavaScript] player error tick 1',
      '[KeplerScript-JavaScript] player error tick 2'
    ])
  })

  test('--system keeps no app entry', () => {
    const entries = kept({ system: true })
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.some((e) => e.process === PLAYER)).toBe(false)
    expect(entries.some((e) => e.process === 'lcm_service')).toBe(true)
  })

  test('--level e keeps only E entries', () => {
    const entries = kept({ level: 'e' })
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((e) => e.level === 'E')).toBe(true)
  })

  test('search is a case-insensitive substring of the message or the tag', () => {
    expect(kept({ search: 'PLAYER MULTI' }).map((e) => e.message)).toEqual([
      '[KeplerScript-JavaScript] player multi\nline two\nline three'
    ])
    expect(kept({ search: 'resmgr-pss' }).every((e) => e.tag === 'resmgr-pss-logger')).toBe(true)
    expect(kept({ search: 'RESMGR-PSS' })).toHaveLength(4)
  })

  test('a regex search', () => {
    const entries = kept({ search: 'flood (11|12)$', regex: true })
    expect(entries.map((e) => e.message)).toEqual([
      '[KeplerScript-JavaScript] player flood 11',
      '[KeplerScript-JavaScript] player flood 12'
    ])
  })

  test('regex without a search is ignored', () => {
    expect(kept({ regex: true })).toHaveLength(ENTRIES.length)
  })

  test('--since drops older entries', () => {
    expect(
      kept({ since: '2026-11-08T07:27:01.27Z' }).every((e) => e.time >= '2026-11-08T07:27:01.270Z')
    ).toBe(true)
    expect(kept({ since: '2026-11-08T07:27:01.27Z' }).length).toBeLessThan(ENTRIES.length)
  })

  test.each<[string, LogFilterInput, string]>([
    ['an invalid regex', { search: '(', regex: true }, 'INVALID_LOG_FILTER'],
    ['an invalid level', { level: 'loud' }, 'INVALID_LOG_FILTER'],
    ['an invalid time', { since: 'soon' }, 'INVALID_LOG_FILTER'],
    ['--until before --since', { since: '2h', until: '3h' }, 'INVALID_LOG_FILTER'],
    ['--app with --system', { app: PLAYER, system: true }, 'INVALID_LOG_FILTER'],
    ['an invalid app ID', { app: 'com.example;rm' }, 'INVALID_APP_ID']
  ])('%s is refused', (_name, input, code) => {
    expect(() => compileLogFilter(input, NOW)).toThrow(expect.objectContaining({ code }))
  })

  test('args record the filter for the activity log', () => {
    expect(
      compileLogFilter(
        {
          app: PLAYER,
          level: 'e',
          since: '2026-11-08T07:00:00Z',
          until: '2026-11-08T08:00:00Z',
          search: 'tick',
          regex: true
        },
        NOW
      )
    ).toMatchObject({
      args: {
        app: PLAYER,
        level: 'error',
        since: '2026-11-08T07:00:00.000Z',
        until: '2026-11-08T08:00:00.000Z',
        grep: 'tick',
        regex: 'true'
      },
      since: Date.parse('2026-11-08T07:00:00Z'),
      until: Date.parse('2026-11-08T08:00:00Z')
    })
    expect(compileLogFilter({ system: true }, NOW).args).toEqual({ system: 'true' })
  })
})

test.each([
  ['com.example.player', true],
  ['com.amazon.screensaver.main', true],
  ['lcm_service', false],
  ['userprofilemanager-server', false],
  [null, false]
])('isAppIdentity(%j) is %s', (identity, expected) => {
  expect(isAppIdentity(identity)).toBe(expected)
})

describe('compileLogFilter: the regex slice', () => {
  const entry = (fields: Partial<LogEntry>): LogEntry => ({
    seq: 0,
    time: '2026-11-08T11:59:00.000Z',
    deviceTime: null,
    level: 'I',
    priority: 'info',
    facility: null,
    process: PLAYER,
    pid: 3571,
    tid: 3571,
    tag: 'js',
    message: '',
    parsed: true,
    ...fields
  })
  const matches = (input: LogFilterInput, e: LogEntry) => compileLogFilter(input, NOW).matches(e)
  const far = 'x'.repeat(REGEX_SLICE_CHARS + 904) + 'needle'
  const near = 'needle' + 'x'.repeat(REGEX_SLICE_CHARS + 904)

  test('a regex match only past the slice isn’t found', () => {
    expect(matches({ search: 'needle', regex: true }, entry({ message: far }))).toBe(false)
  })

  test('a regex match inside the slice is found', () => {
    expect(matches({ search: 'needle', regex: true }, entry({ message: near }))).toBe(true)
  })

  test('plain-text search still sees the whole message', () => {
    expect(matches({ search: 'needle' }, entry({ message: far }))).toBe(true)
  })

  test('the tag is sliced the same way', () => {
    expect(matches({ search: 'needle', regex: true }, entry({ tag: far }))).toBe(false)
    expect(matches({ search: 'needle', regex: true }, entry({ tag: near }))).toBe(true)
    expect(matches({ search: 'needle' }, entry({ tag: far }))).toBe(true)
  })

  test('a pathological pattern on a long line returns quickly', () => {
    const filter = compileLogFilter({ search: 'a*b', regex: true }, NOW)
    const started = Date.now()

    expect(filter.matches(entry({ message: 'a'.repeat(200_000) }))).toBe(false)

    expect(Date.now() - started).toBeLessThan(1_000)
  })
})

test('an OVD entry matches any level, package, system and search filter', () => {
  const ovd: LogEntry = {
    seq: 0,
    time: NOW.toISOString(),
    deviceTime: null,
    level: 'I',
    priority: null,
    facility: null,
    process: null,
    pid: null,
    tid: null,
    tag: 'OVD',
    message: 'Log session restarted',
    parsed: true,
    ovd: { kind: 'restarted', reason: 'install' }
  }
  for (const input of [
    { level: 'error' },
    { app: PLAYER },
    { system: true },
    { search: 'nothing like it' },
    { search: '^zzz$', regex: true }
  ] satisfies LogFilterInput[]) {
    expect(compileLogFilter(input, NOW).matches(ovd)).toBe(true)
  }
})
