import type { Device } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import {
  highlightSegments,
  logsBlocker,
  logsCli,
  logsExportCli,
  packageChoices,
  regexError,
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
