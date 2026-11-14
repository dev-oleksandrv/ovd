import type { Device } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import { entries, logEntry } from './sample'
import {
  BUNDLE_CLI_NOTE,
  bootLabel,
  coversTime,
  crashLogsOutcome,
  highlightSegments,
  filterChips,
  filterNameError,
  indexAtTime,
  logsBlocker,
  logsBundleCli,
  logsCli,
  logsExportCli,
  logsRemoveCli,
  logsSaveCli,
  parseBootValue,
  parseNumberValue,
  parseRateValue,
  parseWordValue,
  presetMatch,
  ruleChips,
  withRule,
  packageChoices,
  regexError,
  ROTATION_HINT,
  sessionLabel,
  shellQuote,
  timeOfDay,
  withPackage
} from '../../../../src/renderer/src/screens/logs/logsView'

const STICK = 'G070000000000001'

describe('logsCli', () => {
  test.each([
    [{}, `ovd logs --device ${STICK}`],
    [{ level: 'v' }, `ovd logs --device ${STICK}`],
    [{ level: 'e' }, `ovd logs --level error --device ${STICK}`],
    [{ level: 'w' }, `ovd logs --level warn --device ${STICK}`],
    [{ system: true, level: 'd' }, `ovd logs --system --level debug --device ${STICK}`],
    [
      { app: 'com.example.player', level: 'e', search: 'tick', regex: true },
      `ovd logs --app com.example.player --level error --grep "tick" --regex --device ${STICK}`
    ],
    [{ regex: true }, `ovd logs --device ${STICK}`],
    [
      { search: 'say "hi" $HOME `x` \\' },
      `ovd logs --grep "say \\"hi\\" \\$HOME \\\`x\\\` \\\\" --device ${STICK}`
    ],
    [{ search: "it's" }, `ovd logs --grep "it's" --device ${STICK}`],
    [
      { app: 'com.example.player;touch /tmp/x' },
      `ovd logs --app 'com.example.player;touch /tmp/x' --device ${STICK}`
    ],
    [{ app: "x'$(id)'" }, `ovd logs --app 'x'\\''$(id)'\\''' --device ${STICK}`]
  ])('%o → %s', (filter, cli) => {
    expect(logsCli(filter, STICK)).toBe(cli)
  })

  test.each([
    ['192.0.2.10:5555', 'ovd logs --device 192.0.2.10:5555'],
    ['VirtualDevice', 'ovd logs --device VirtualDevice'],
    ['a b', "ovd logs --device 'a b'"],
    ['$(reboot)', "ovd logs --device '$(reboot)'"]
  ])('quotes the device %s only when it needs it', (device, cli) => {
    expect(logsCli({}, device)).toBe(cli)
  })

  test.each([
    [{}, `ovd logs --no-restart-after-install --device ${STICK}`],
    [
      { app: 'com.example.player', level: 'e', search: 'tick' },
      `ovd logs --app com.example.player --level error --grep "tick" --no-restart-after-install --device ${STICK}`
    ]
  ])('with restart after install off %o → %s', (filter, cli) => {
    expect(logsCli(filter, STICK, false)).toBe(cli)
    expect(logsCli(filter, STICK, true)).toBe(cli.replace(' --no-restart-after-install', ''))
  })
})

describe('logsExportCli', () => {
  const UNTIL = '2026-11-08T07:27:01.257Z'
  const saved = {
    path: '/home/dev/player.txt',
    format: 'text' as const,
    until: UNTIL,
    replaced: false
  }

  test.each([
    [{}, true, saved, `ovd logs --until ${UNTIL} --export /home/dev/player.txt --device ${STICK}`],
    [
      { app: 'com.example.player', level: 'e', search: 'tick 2', regex: true },
      true,
      { ...saved, path: '/home/dev/player.jsonl', format: 'jsonl' as const },
      `ovd logs --app com.example.player --level error --grep "tick 2" --regex --until ${UNTIL} --export /home/dev/player.jsonl --format jsonl --device ${STICK}`
    ],
    [
      {},
      false,
      { ...saved, replaced: true },
      `ovd logs --no-restart-after-install --until ${UNTIL} --export /home/dev/player.txt --force --device ${STICK}`
    ],
    [
      {},
      true,
      { ...saved, path: "/home/dev/Dev Logs/it's.txt" },
      `ovd logs --until ${UNTIL} --export '/home/dev/Dev Logs/it'\\''s.txt' --device ${STICK}`
    ]
  ])('%o (restart %s) → %s', (filter, restart, exported, cli) => {
    expect(logsExportCli(filter, STICK, restart, exported)).toBe(cli)
  })

  test('quotes the device as logsCli does', () => {
    expect(logsExportCli({}, 'a b', true, saved)).toMatch(/ --device 'a b'$/)
  })
})

describe('shellQuote', () => {
  test.each([
    ['com.example.player', 'com.example.player'],
    ['G070000000000001', 'G070000000000001'],
    ['', "''"],
    ['~/x', "'~/x'"],
    ['a;b', "'a;b'"],
    ['a\nb', "'a\nb'"],
    ["'", `''\\'''`]
  ])('%j → %s', (text, quoted) => {
    expect(shellQuote(text)).toBe(quoted)
  })
})

describe('packageChoices', () => {
  test('All, the seen apps and the project app (sorted, once), then System', () => {
    expect(
      packageChoices(['com.example.player', 'com.example.hellovega'], 'com.example.player')
    ).toEqual([
      { value: 'all', label: 'All' },
      { value: 'com.example.hellovega', label: 'com.example.hellovega' },
      { value: 'com.example.player', label: 'com.example.player' },
      { value: 'system', label: 'System' }
    ])
    expect(packageChoices([], null).map((c) => c.label)).toEqual(['All', 'System'])
  })

  test.each(['com.example.player;touch /tmp/x', "x'$(id)'", '.hidden', '-rf', ''])(
    'leaves out a project ID that is not an app ID: %j',
    (projectAppId) => {
      expect(packageChoices(['com.example.hellovega'], projectAppId)).toEqual([
        { value: 'all', label: 'All' },
        { value: 'com.example.hellovega', label: 'com.example.hellovega' },
        { value: 'system', label: 'System' }
      ])
    }
  )

  test.each([
    ['all', {}],
    ['system', { system: true }],
    ['com.example.player', { app: 'com.example.player' }]
  ])('withPackage(%s)', (value, filter) => {
    expect(withPackage({ app: 'com.example.hellovega', level: 'e' }, value)).toEqual({
      level: 'e',
      ...filter
    })
  })
})

describe('highlightSegments', () => {
  test.each([
    ['no search', 'player tick 2', '', false, [{ text: 'player tick 2', hit: false }]],
    [
      'a case-insensitive substring',
      'player Tick 2 tick',
      'tick',
      false,
      [
        { text: 'player ', hit: false },
        { text: 'Tick', hit: true },
        { text: ' 2 ', hit: false },
        { text: 'tick', hit: true }
      ]
    ],
    [
      'a regex',
      'player error tick 2',
      'tick \\d',
      true,
      [
        { text: 'player error ', hit: false },
        { text: 'tick 2', hit: true }
      ]
    ],
    [
      'regex characters as text',
      'a.b',
      '.',
      false,
      [
        { text: 'a', hit: false },
        { text: '.', hit: true },
        { text: 'b', hit: false }
      ]
    ],
    ['zero-length matches skipped', 'abc', 'x*', true, [{ text: 'abc', hit: false }]],
    ['an invalid regex', 'abc', '(', true, [{ text: 'abc', hit: false }]]
  ])('%s', (_n, text, search, regex, segments) => {
    expect(highlightSegments(text, search, regex)).toEqual(segments)
  })
})

describe('labels', () => {
  const at = new Date(2026, 10, 8, 7, 27, 0, 257)

  test('timeOfDay is local HH:MM:SS.mmm', () => {
    expect(timeOfDay(at.toISOString())).toBe('07:27:00.257')
  })

  test('sessionLabel', () => {
    expect(
      sessionLabel({
        status: 'running',
        device: STICK,
        name: 'Fire TV stick',
        startedAt: at.toISOString(),
        restartAfterInstall: true
      })
    ).toBe('Fire TV stick · since 07:27:00')
    expect(
      sessionLabel({
        status: 'reconnecting',
        device: STICK,
        name: 'Fire TV stick',
        startedAt: at.toISOString(),
        restartAfterInstall: false
      })
    ).toBe('Fire TV stick · since 07:27:00')
    expect(
      sessionLabel({
        status: 'starting',
        device: STICK,
        name: 'Fire TV stick',
        restartAfterInstall: true
      })
    ).toBe('Fire TV stick')
    expect(sessionLabel({ status: 'idle' })).toBe('')
  })

  test('regexError', () => {
    expect(regexError('(', true)).not.toBeNull()
    expect(regexError('(', false)).toBeNull()
    expect(regexError('tick \\d', true)).toBeNull()
  })

  test('logsBlocker', () => {
    const device = { id: STICK, status: 'online' } as Device
    expect(logsBlocker(undefined)).toBe('no-target')
    expect(logsBlocker({ ...device, status: 'offline' })).toBe('offline')
    expect(logsBlocker(device)).toBeNull()
  })
})

describe('logs at crash time', () => {
  const start = '2026-11-13T10:00:00.000Z'

  test('the retained history covers a crash at or after its oldest line', () => {
    expect(coversTime(start, '2026-11-13T10:00:05.000Z')).toBe(true)
    expect(coversTime(start, start)).toBe(true)
  })

  test('it doesn’t cover a crash before its oldest line, an empty history or a bad time', () => {
    expect(coversTime(start, '2026-11-13T09:59:59.000Z')).toBe(false)
    expect(coversTime(undefined, start)).toBe(false)
    expect(coversTime('nope', start)).toBe(false)
    expect(coversTime(start, 'nope')).toBe(false)
  })

  test('a full buffer still covers a crash its oldest retained line reaches back to', () => {
    // 150,000 lines were received, but the oldest of the retained ones is before the crash.
    const outcome = crashLogsOutcome(
      { n: 1, app: 'com.example.player', pid: 27178, time: '2026-11-13T10:00:30.000Z' },
      { lines: 150_000, oldest: start },
      entries(5).map((e, i) => logEntry(e.seq, { time: `2026-11-13T10:00:${30 + i}.000Z` }))
    )
    expect(outcome).toEqual({ kind: 'scroll', index: 0 })
  })

  test('after Clear nothing is retained: the journal note, not a coverage claim', () => {
    const outcome = crashLogsOutcome(
      { n: 1, app: 'com.example.player', pid: 27178, time: '2026-11-13T10:00:30.000Z' },
      { lines: 0 },
      []
    )
    expect(outcome).toMatchObject({ kind: 'note', body: ROTATION_HINT })
  })

  test('after an eviction past the crash the journal note is shown', () => {
    const outcome = crashLogsOutcome(
      { n: 1, app: 'com.example.player', pid: 27178, time: '2026-11-13T10:00:30.000Z' },
      { lines: 90_000, oldest: '2026-11-13T10:01:00.000Z' },
      entries(5).map((e, i) => logEntry(e.seq, { time: `2026-11-13T10:01:0${i}.000Z` }))
    )
    expect(outcome).toMatchObject({ kind: 'note', body: ROTATION_HINT })
  })

  test('the row is the first line at or after the time, else the last before it', () => {
    const lines = entries(5).map((e, i) => logEntry(e.seq, { time: `2026-11-13T10:00:0${i}.000Z` }))
    expect(indexAtTime(lines, '2026-11-13T10:00:02.000Z')).toBe(2)
    expect(indexAtTime(lines, '2026-11-13T10:00:01.500Z')).toBe(2)
    expect(indexAtTime(lines, '2026-11-13T10:01:00.000Z')).toBe(4)
    expect(indexAtTime(lines, '2026-11-13T09:00:00.000Z')).toBe(0)
    expect(indexAtTime([], start)).toBe(-1)
  })
})

const PRESETS = [
  { key: 'all', label: 'All', filter: {} },
  { key: 'app-errors', label: 'App errors only', filter: { level: 'error', appsOnly: true } },
  { key: 'network', label: 'Network', filter: { search: '\\bhttp\\b', regex: true } },
  { key: 'lifecycle', label: 'Lifecycle', filter: { lifecycle: true } }
]

describe('the advanced filters in the echo', () => {
  test('every field is a repeatable flag, in the CLI’s order, with the rules last', () => {
    expect(
      logsCli(
        {
          app: 'com.example.player',
          level: 'w',
          search: 'tick',
          pid: [27178, 27179],
          tid: [5],
          tag: ['com.amazon.keplerscript'],
          identity: ['lcm_service'],
          facility: ['user', 'local0'],
          boot: ['current'],
          processRules: [
            { identity: 'com.example.player', level: 'W', rate: 10 },
            { identity: 'lcm_service', mute: true }
          ]
        },
        STICK
      )
    ).toBe(
      'ovd logs --app com.example.player --level warn --grep "tick" --pid 27178 --pid 27179 --tid 5 ' +
        '--tag com.amazon.keplerscript --identity lcm_service --facility user --facility local0 ' +
        '--boot current --process-level com.example.player=W --process-rate com.example.player=10 ' +
        `--mute lcm_service --device ${STICK}`
    )
  })

  test('values with spaces or shell characters are quoted', () => {
    expect(
      logsCli(
        { tag: ['my tag'], identity: ['x;y'], processRules: [{ identity: 'a b', mute: true }] },
        STICK
      )
    ).toBe(`ovd logs --tag 'my tag' --identity 'x;y' --mute 'a b' --device ${STICK}`)
    expect(logsCli({ processRules: [{ identity: 'a b', rate: 3 }] }, STICK)).toContain(
      "--process-rate 'a b=3'"
    )
  })

  test('a level name in a rule becomes its letter', () => {
    expect(logsCli({ processRules: [{ identity: 'x', level: 'warn' }] }, STICK)).toContain(
      '--process-level x=W'
    )
  })

  test('a filter that equals a preset or a saved filter is its --preset', () => {
    expect(logsCli({ level: 'error', appsOnly: true }, STICK, true, 'app-errors')).toBe(
      `ovd logs --preset app-errors --device ${STICK}`
    )
    expect(logsCli({ level: 'e' }, STICK, true, 'errors')).toBe(
      `ovd logs --preset errors --device ${STICK}`
    )
    expect(logsCli({}, STICK, true, 'all')).toBe(`ovd logs --device ${STICK}`)
    expect(logsCli({ lifecycle: true }, STICK, false, 'lifecycle')).toBe(
      `ovd logs --preset lifecycle --no-restart-after-install --device ${STICK}`
    )
  })

  test('an edited built-in preset keeps its --preset and says its level', () => {
    expect(logsCli({ appsOnly: true, pid: [1] }, STICK)).toBe(
      `ovd logs --level verbose --pid 1 --preset app-errors --device ${STICK}`
    )
    expect(logsCli({ appsOnly: true, level: 'w' }, STICK)).toBe(
      `ovd logs --level warn --preset app-errors --device ${STICK}`
    )
    expect(logsCli({ lifecycle: true, tag: ['x'] }, STICK)).toBe(
      `ovd logs --tag x --preset lifecycle --device ${STICK}`
    )
  })

  test('the export echo carries the new fields too', () => {
    expect(
      logsExportCli({ pid: [7] }, STICK, true, {
        path: '/tmp/a.txt',
        format: 'text',
        until: '2026-11-08T07:27:00.257Z',
        replaced: false
      })
    ).toBe(
      `ovd logs --pid 7 --until 2026-11-08T07:27:00.257Z --export /tmp/a.txt --device ${STICK}`
    )
  })

  test('filter save and rm echoes; a boot ID is never saved', () => {
    expect(
      logsSaveCli('player-errors', { app: 'com.example.player', level: 'e', boot: ['current'] })
    ).toBe('ovd logs filter save player-errors --app com.example.player --level error')
    expect(logsSaveCli('x', { pid: [1] }, null, true)).toBe(
      'ovd logs filter save x --pid 1 --force'
    )
    expect(logsRemoveCli('player-errors')).toBe('ovd logs filter rm player-errors')
  })

  test('the bundle echo has the device first, then the flags, and a note about the CLI', () => {
    expect(logsBundleCli({ level: 'e', pid: [7] }, STICK)).toBe(
      `ovd logs bundle --device ${STICK} --level error --pid 7`
    )
    expect(logsBundleCli({}, STICK)).toBe(`ovd logs bundle --device ${STICK}`)
    expect(logsBundleCli({ level: 'error', appsOnly: true }, STICK, 'app-errors')).toBe(
      `ovd logs bundle --device ${STICK} --preset app-errors`
    )
    expect(BUNDLE_CLI_NOTE).toMatch(/journal backlog/)
  })
})

describe('presetMatch', () => {
  const saved = [
    { name: 'errors', filter: { level: 'e' }, valid: true as const },
    {
      name: 'broken',
      filter: {},
      valid: false as const,
      error: { code: 'INVALID_LOG_FILTER' as const, message: 'bad', hint: 'fix' }
    }
  ]

  test('the filter a preset sets matches it, whatever the level is spelled like', () => {
    expect(presetMatch({}, PRESETS, saved)).toBe('all')
    expect(presetMatch({ level: 'v' }, PRESETS, saved)).toBe('all')
    expect(presetMatch({ level: 'e', appsOnly: true }, PRESETS, saved)).toBe('app-errors')
    expect(presetMatch({ lifecycle: true }, PRESETS, saved)).toBe('lifecycle')
    expect(presetMatch({ level: 'error' }, PRESETS, saved)).toBe('errors')
  })

  test('any edit is Custom (null)', () => {
    expect(presetMatch({ pid: [1] }, PRESETS, saved)).toBeNull()
    expect(presetMatch({ level: 'w' }, PRESETS, saved)).toBeNull()
    expect(presetMatch({ lifecycle: true, tag: ['x'] }, PRESETS, saved)).toBeNull()
    expect(presetMatch({ search: 'x', regex: true }, PRESETS, saved)).toBeNull()
  })

  test('an invalid saved filter never matches', () => {
    expect(presetMatch({}, [], saved)).toBeNull()
  })

  test('a regex flag without a search is no difference', () => {
    expect(presetMatch({ regex: true }, PRESETS, saved)).toBe('all')
  })
})

describe('filter and rule chips', () => {
  test('one chip per value, and each removes only itself', () => {
    const filter = { pid: [1, 2], tag: ['a'], boot: ['current'], level: 'e' }
    const chips = filterChips(filter)
    expect(chips.map((c) => c.label)).toEqual(['PID 1', 'PID 2', 'Tag a', 'This boot'])
    expect(chips[0]?.remove(filter)).toEqual({
      pid: [2],
      tag: ['a'],
      boot: ['current'],
      level: 'e'
    })
    expect(chips[2]?.remove(filter)).toEqual({ pid: [1, 2], boot: ['current'], level: 'e' })
    expect(chips[3]?.remove(filter)).toEqual({ pid: [1, 2], tag: ['a'], level: 'e' })
  })

  test('a boot ID is shortened', () => {
    expect(bootLabel('0123456789abcdef0123456789abcdef')).toBe('Boot 01234567')
  })

  test('rule chips: mute, level and limit, each removable; an empty rule goes away', () => {
    const filter = withRule(withRule(withRule({}, 'x', { mute: true }), 'x', { rate: 5 }), 'y', {
      level: 'W'
    })
    const chips = ruleChips(filter)
    expect(chips.map((c) => c.label)).toEqual(['Muted x', 'x limited to 5/s', 'y at W+'])
    expect(chips[0]?.remove(filter).processRules).toEqual([
      { identity: 'x', rate: 5 },
      { identity: 'y', level: 'W' }
    ])
    expect(chips[2]?.remove(filter).processRules).toEqual([{ identity: 'x', mute: true, rate: 5 }])
    const only = withRule({ level: 'e' }, 'x', { mute: true })
    expect(ruleChips(only)[0]?.remove(only)).toEqual({ level: 'e' })
  })

  test('a later change of one field replaces the earlier one', () => {
    expect(withRule(withRule({}, 'x', { rate: 5 }), 'x', { rate: 9 }).processRules).toEqual([
      { identity: 'x', rate: 9 }
    ])
  })
})

describe('what the user types', () => {
  test('a saved filter name follows core’s rule', () => {
    const reserved = ['all', 'network']
    expect(filterNameError('player-errors', reserved)).toBeNull()
    expect(filterNameError('', reserved)).toMatch(/name/)
    expect(filterNameError('Player', reserved)).toMatch(/lower-case/)
    expect(filterNameError('a'.repeat(41), reserved)).toMatch(/40/)
    expect(filterNameError('network', reserved)).toMatch(/built-in/)
  })

  test('PID and TID are non-negative integers', () => {
    expect(parseNumberValue(' 27178 ', 'A PID')).toEqual({ ok: true, value: 27178 })
    expect(parseNumberValue('-1', 'A PID').ok).toBe(false)
    expect(parseNumberValue('1.5', 'A PID').ok).toBe(false)
    expect(parseNumberValue('abc', 'A PID').ok).toBe(false)
    expect(parseNumberValue('', 'A PID').ok).toBe(false)
    expect(parseNumberValue('99999999999999999999', 'A PID').ok).toBe(false)
  })

  test('tags and identities are 1–128 characters without control characters', () => {
    expect(parseWordValue('lcm_service', 'An identity')).toEqual({ ok: true, value: 'lcm_service' })
    expect(parseWordValue('', 'A tag').ok).toBe(false)
    expect(parseWordValue('x'.repeat(129), 'A tag').ok).toBe(false)
    expect(parseWordValue('a\u0007b', 'A tag').ok).toBe(false)
  })

  test('a boot ID is 32 hex characters, dashes allowed, or current', () => {
    expect(parseBootValue('CURRENT')).toEqual({ ok: true, value: 'current' })
    expect(parseBootValue('01234567-89ab-cdef-0123-456789abcdef').ok).toBe(true)
    expect(parseBootValue('0123').ok).toBe(false)
  })

  test('a limit is 1 to 10000', () => {
    expect(parseRateValue('10')).toEqual({ ok: true, value: 10 })
    expect(parseRateValue('0').ok).toBe(false)
    expect(parseRateValue('10001').ok).toBe(false)
    expect(parseRateValue('x').ok).toBe(false)
  })
})
