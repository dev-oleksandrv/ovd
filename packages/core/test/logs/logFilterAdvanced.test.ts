import { describe, expect, test } from 'vitest'
import { compileLogFilter, LOG_FACILITIES, type LogFilterInput } from '../../src/logs/logFilter.js'
import { FILTER_TEXT_MAX } from '../../src/logs/processRules.js'
import type { LogEntry } from '../../src/logs/types.js'
import { costVsBaseline, MAX_COST_VS_BASELINE } from '../support/regexCost.js'
import { logLine, parseLines } from './logLines.js'

const NOW = new Date('2026-11-08T12:00:00Z')
const PLAYER = 'com.example.player'
const BOOT_A = '0b6a5f2e3c414d7a9e581f2a3b4c5d6e'
const BOOT_B = 'ffffffffffffffffffffffffffffffff'

const ENTRIES: LogEntry[] = parseLines(
  [
    logLine({ time: '07:27:00.100000', identity: PLAYER, pid: 10, tid: 11, message: 'a' }),
    logLine({
      time: '07:27:00.200000',
      identity: PLAYER,
      pid: 10,
      tid: 12,
      priority: 'err',
      message: 'b'
    }),
    logLine({
      time: '07:27:00.300000',
      identity: 'lcm_service',
      pid: 20,
      tid: 20,
      facility: 'daemon',
      tag: 'lcm-server',
      message: 'c'
    }),
    logLine({
      time: '07:27:00.400000',
      identity: 'stemd',
      pid: 30,
      tid: 31,
      facility: 'daemon',
      tag: 'com.amazon.appfwk.stemd',
      message: 'd'
    })
  ].join('')
).map((entry) => ({ ...entry, ...(entry.seq < 2 ? { boot: BOOT_A } : { boot: BOOT_B }) }))

const kept = (input: LogFilterInput, ctx?: Parameters<typeof compileLogFilter>[2]) => {
  const filter = compileLogFilter(input, NOW, ctx)
  return ENTRIES.filter((e) => filter.matches(e)).map((e) => e.message)
}

const rejected = (input: LogFilterInput) =>
  expect(() => compileLogFilter(input, NOW)).toThrow(
    expect.objectContaining({ code: 'INVALID_LOG_FILTER' })
  )

describe('field filters', () => {
  test('pid and tid match exactly; values of one field are ORed', () => {
    expect(kept({ pid: [10] })).toEqual(['a', 'b'])
    expect(kept({ pid: [10, 30] })).toEqual(['a', 'b', 'd'])
    expect(kept({ tid: [12] })).toEqual(['b'])
    expect(kept({ tid: ['11', 20] })).toEqual(['a', 'c'])
    expect(kept({ pid: [999] })).toEqual([])
  })

  test('tag and identity match exactly and case-sensitively', () => {
    expect(kept({ tag: ['lcm-server'] })).toEqual(['c'])
    expect(kept({ tag: ['LCM-SERVER'] })).toEqual([])
    expect(kept({ tag: ['lcm-server', 'com.amazon.appfwk.stemd'] })).toEqual(['c', 'd'])
    expect(kept({ identity: ['lcm_service'] })).toEqual(['c'])
    expect(kept({ identity: ['lcm_service', 'stemd'] })).toEqual(['c', 'd'])
    expect(kept({ identity: ['lcm'] })).toEqual([])
    expect(kept({ identity: [PLAYER] })).toEqual(['a', 'b'])
  })

  test('facility matches the parsed facility, any case', () => {
    expect(kept({ facility: ['daemon'] })).toEqual(['c', 'd'])
    expect(kept({ facility: ['DAEMON', 'local0'] })).toEqual(['a', 'b', 'c', 'd'])
    expect(kept({ facility: ['local1'] })).toEqual([])
  })

  test('boot matches the entry’s boot tag: dashes dropped, case folded', () => {
    expect(kept({ boot: [BOOT_A] })).toEqual(['a', 'b'])
    expect(kept({ boot: ['0B6A5F2E-3C41-4D7A-9E58-1F2A3B4C5D6E'] })).toEqual(['a', 'b'])
    expect(kept({ boot: [BOOT_A, BOOT_B] })).toEqual(['a', 'b', 'c', 'd'])
  })

  test('boot current is the running stream’s boot, and nothing while it is unknown', () => {
    let current: string | undefined = BOOT_B
    const ctx = { currentBoot: () => current }
    expect(kept({ boot: ['current'] }, ctx)).toEqual(['c', 'd'])
    current = BOOT_A
    expect(kept({ boot: ['current'] }, ctx)).toEqual(['a', 'b'])
    current = undefined
    expect(kept({ boot: ['current'] }, ctx)).toEqual([])
    expect(kept({ boot: ['current'] })).toEqual([])
  })

  test('an entry without a boot tag matches no boot filter', () => {
    const filter = compileLogFilter({ boot: [BOOT_A] }, NOW)
    const untagged: LogEntry = { ...(ENTRIES[0] as LogEntry) }
    delete untagged.boot
    expect(filter.matches(untagged)).toBe(false)
    expect(filter.usesBoot).toBe(true)
    expect(compileLogFilter({}, NOW).usesBoot).toBe(false)
  })

  test('different fields combine with AND, and with the existing ones', () => {
    expect(kept({ pid: [10], tid: [12] })).toEqual(['b'])
    expect(kept({ pid: [10], tid: [20] })).toEqual([])
    expect(kept({ facility: ['daemon'], identity: ['stemd'] })).toEqual(['d'])
    expect(kept({ identity: [PLAYER], level: 'error' })).toEqual(['b'])
    expect(kept({ identity: [PLAYER, 'stemd'], pid: [10, 30], search: 'd' })).toEqual(['d'])
    expect(kept({ app: PLAYER, tid: [11] })).toEqual(['a'])
    expect(kept({ system: true, facility: ['daemon'], boot: [BOOT_B] })).toEqual(['c', 'd'])
  })

  test('empty arrays filter nothing', () => {
    expect(kept({ pid: [], tid: [], tag: [], identity: [], facility: [], boot: [] })).toHaveLength(
      4
    )
  })

  test('apps only keeps package-ID-shaped identities, and refuses --system', () => {
    expect(kept({ appsOnly: true })).toEqual(['a', 'b'])
    rejected({ appsOnly: true, system: true })
  })

  test('OVD lines show whatever the field filters', () => {
    const filter = compileLogFilter({ pid: [1], boot: ['current'], tag: ['x'] }, NOW)
    const ovd = { ...ENTRIES[0], ovd: { kind: 'reconnected' } } as LogEntry
    expect(filter.matches(ovd)).toBe(true)
  })

  test('args record each field as a comma-joined string, without repeats', () => {
    const filter = compileLogFilter(
      {
        pid: [10, '30', 10],
        tid: [1],
        tag: ['a', 'b'],
        identity: ['x'],
        facility: ['DAEMON', 'local0'],
        boot: ['0B6A5F2E-3C41-4D7A-9E58-1F2A3B4C5D6E', 'current'],
        appsOnly: true
      },
      NOW
    )
    expect(filter.args).toEqual({
      'apps-only': 'true',
      pid: '10,30',
      tid: '1',
      tag: 'a,b',
      identity: 'x',
      facility: 'daemon,local0',
      boot: `${BOOT_A},current`
    })
  })
})

describe('field validation', () => {
  const ctrl = (c: string) => `a${c}b`
  const CONTROL_CHARS = ['\u0000', '\n', '\t', '\u001b', '\u007f', '\u0085', '‮', '‏']

  test.each([
    ['pid', -1],
    ['pid', 1.5],
    ['pid', Number.NaN],
    ['pid', Number.POSITIVE_INFINITY],
    ['pid', Number.MAX_SAFE_INTEGER + 1],
    ['pid', ''],
    ['pid', 'abc'],
    ['pid', '-3'],
    ['pid', '1e3'],
    ['pid', ' 12'],
    ['pid', '0x10'],
    ['pid', '1'.repeat(16)],
    ['tid', -1],
    ['tid', '1.5'],
    ['tid', 'x']
  ] as const)('--%s %j is refused', (field, value) => {
    rejected({ [field]: [value] })
  })

  test.each([0, 1, 4_294_967_295, '0', '007'])('--pid %j is accepted', (value) => {
    expect(() => compileLogFilter({ pid: [value] }, NOW)).not.toThrow()
  })

  test.each(['tag', 'identity'] as const)('--%s: length and characters', (field) => {
    expect(() => compileLogFilter({ [field]: ['a'] }, NOW)).not.toThrow()
    expect(() => compileLogFilter({ [field]: ['lcm_service'] }, NOW)).not.toThrow()
    expect(() => compileLogFilter({ [field]: ['x'.repeat(FILTER_TEXT_MAX)] }, NOW)).not.toThrow()
    // Own check, not assertAppId: spaces and dots are fine, brackets too.
    expect(() => compileLogFilter({ [field]: ['a b[1]:'] }, NOW)).not.toThrow()
    rejected({ [field]: [''] })
    rejected({ [field]: ['x'.repeat(FILTER_TEXT_MAX + 1)] })
    for (const c of CONTROL_CHARS) rejected({ [field]: [ctrl(c)] })
    // One bad value among good ones refuses the filter.
    rejected({ [field]: ['ok', ''] })
  })

  test('an oversized value is counted in characters, not code units', () => {
    const emoji = '😀'.repeat(FILTER_TEXT_MAX)
    expect(() => compileLogFilter({ tag: [emoji] }, NOW)).not.toThrow()
    rejected({ tag: [`${emoji}😀`] })
  })

  test.each(LOG_FACILITIES)('--facility %s is a syslog facility', (facility) => {
    expect(() => compileLogFilter({ facility: [facility] }, NOW)).not.toThrow()
  })

  test.each(['', 'local8', 'daemon.info', 'kernel', 'a b', ctrl('\n')])(
    '--facility %j is refused',
    (value) => {
      rejected({ facility: [value] })
    }
  )

  test('the facility list is the 12 named ones and local0 to local7', () => {
    expect(LOG_FACILITIES).toHaveLength(20)
    expect(LOG_FACILITIES).toContain('local7')
    expect(LOG_FACILITIES).toContain('authpriv')
  })

  test.each([
    '',
    'now',
    BOOT_A.slice(1),
    `${BOOT_A}0`,
    'g'.repeat(32),
    '0b6a5f2e-3c41-4d7a-9e58-1f2a3b4c5d6e0',
    `${BOOT_A}\n`.replace('\n', '\u0000'),
    'current;rm -rf /'
  ])('--boot %j is refused', (value) => {
    rejected({ boot: [value] })
  })

  test.each(['current', 'CURRENT', BOOT_A, '0b6a5f2e-3c41-4d7a-9e58-1f2a3b4c5d6e'])(
    '--boot %s is accepted',
    (value) => {
      expect(() => compileLogFilter({ boot: [value] }, NOW)).not.toThrow()
    }
  )
})

describe('regex safety', () => {
  const bad = (pattern: string) => rejected({ search: pattern, regex: true })

  test('every regex goes through assertSafeRegex', () => {
    bad('(a+)+$')
    bad('(a)\\1')
    bad('(?<=a)b')
    bad('a'.repeat(513))
  })

  test('the refusal comes before any match and names the problem', () => {
    expect(() => compileLogFilter({ search: '(a+)+$', regex: true }, NOW)).toThrow(/repeated group/)
  })

  test('a plain-text search keeps any text, brackets and backslashes included', () => {
    expect(() => compileLogFilter({ search: '(a+)+$' }, NOW)).not.toThrow()
    expect(() => compileLogFilter({ search: '\\1' }, NOW)).not.toThrow()
  })

  test('a syntax error still gets the engine’s message', () => {
    expect(() => compileLogFilter({ search: '(', regex: true }, NOW)).toThrow(
      /isn’t a valid regular expression/
    )
  })

  test('safe neighbours cost about one open-ended repeat on a hostile 4096-character message', () => {
    const hostile = `${'a'.repeat(4_095)}!`
    const entry = { ...(ENTRIES[0] as LogEntry), message: hostile, tag: 't' }
    for (const pattern of ['(ab)+$', 'a+b', '(?:aa)+b', '^(a+)?b']) {
      const filter = compileLogFilter({ search: pattern, regex: true }, NOW)
      expect(costVsBaseline(hostile, () => filter.matches(entry))).toBeLessThan(
        MAX_COST_VS_BASELINE
      )
    }
  })
})

describe('process rules in the filter', () => {
  test('mute hides the process, and beats a level rule and --app', () => {
    expect(kept({ processRules: [{ identity: PLAYER, mute: true, level: 'V', rate: 5 }] })).toEqual(
      ['c', 'd']
    )
    expect(kept({ app: PLAYER, processRules: [{ identity: PLAYER, mute: true }] })).toEqual([])
  })

  test('a level rule replaces the global level for its process only', () => {
    // Global level error: the player shows from info, the others stay at error.
    expect(kept({ level: 'error', processRules: [{ identity: PLAYER, level: 'I' }] })).toEqual([
      'a',
      'b'
    ])
    // And the other way: stricter for the player than the global level.
    expect(kept({ level: 'info', processRules: [{ identity: PLAYER, level: 'error' }] })).toEqual([
      'b',
      'c',
      'd'
    ])
  })

  test('a rule on an identity no entry has changes nothing', () => {
    expect(kept({ processRules: [{ identity: 'nobody', mute: true }] })).toHaveLength(4)
  })

  test('rules are validated, and recorded in args', () => {
    const filter = compileLogFilter(
      {
        processRules: [
          { identity: PLAYER, level: 'warn', rate: '20' },
          { identity: 'stemd', mute: true },
          { identity: PLAYER, mute: true }
        ]
      },
      NOW
    )
    expect(filter.args).toEqual({
      'process-level': `${PLAYER}=warn`,
      'process-rate': `${PLAYER}=20`,
      mute: `${PLAYER},stemd`
    })
    rejected({ processRules: [{ identity: PLAYER }] })
    rejected({ processRules: [{ identity: '', mute: true }] })
    rejected({ processRules: [{ identity: PLAYER, level: 'loud' }] })
    rejected({ processRules: [{ identity: PLAYER, rate: 0 }] })
    rejected({ processRules: [{ identity: PLAYER, rate: 10_001 }] })
    rejected({ processRules: [{ identity: PLAYER, rate: 1.5 }] })
    rejected({ processRules: [{ identity: PLAYER, rate: 'fast' }] })
    rejected({ processRules: [{ identity: 'a\nb', mute: true }] })
  })
})
