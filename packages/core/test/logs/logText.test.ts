import { expect, test } from 'vitest'
import { logText, logTextAll, ovdEventText } from '../../src/logs/logText.js'
import type { LogEntry, OvdEvent } from '../../src/logs/types.js'

const TIME = '2026-11-08T07:27:00.257Z'
const d = new Date(TIME)
const two = (n: number) => String(n).padStart(2, '0')
const CLOCK = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.257`

const entry: LogEntry = {
  seq: 0,
  time: TIME,
  deviceTime: 'Nov 08 07:27:00.257342',
  level: 'E',
  priority: 'err',
  facility: 'local0',
  process: 'com.example.player',
  pid: 27178,
  tid: 2842092448,
  tag: 'com.amazon.keplerscript',
  message: '[KeplerScript-JavaScript] player error tick 1',
  parsed: true
}

test('one line: local time, level, padded tag, right-aligned pid, message', () => {
  expect(logText(entry)).toBe(
    `${CLOCK} E com.amazon.keplerscript   27178 [KeplerScript-JavaScript] player error tick 1\n`
  )
})

test('continuation lines are indented to the message column', () => {
  const text = logText({ ...entry, message: 'first\nline two' })
  const [head = '', second = ''] = text.split('\n')
  expect(second.trimStart()).toBe('line two')
  expect(second.length - 'line two'.length).toBe(head.length - 'first'.length)
})

test('a missing pid is a dash', () => {
  expect(logText({ ...entry, pid: null, tag: 'x' })).toBe(
    `${CLOCK} E ${'x'.padEnd(24)}      - [KeplerScript-JavaScript] player error tick 1\n`
  )
})

test('paintLevel wraps only the level letter', () => {
  const text = logText(entry, { paintLevel: (level, t) => `<${level}:${t}>` })
  expect(text.startsWith(`${CLOCK} <E:E> com.amazon.keplerscript `)).toBe(true)
})

test('logTextAll joins the lines', () => {
  expect(logTextAll([entry, entry])).toBe(logText(entry) + logText(entry))
})

test.each<[string, OvdEvent, string]>([
  [
    'install ok from the desktop',
    {
      kind: 'install',
      action: 'app.install',
      surface: 'desktop',
      result: 'ok',
      package: 'player_armv7.vpkg',
      app: 'com.example.player'
    },
    'Installed player_armv7.vpkg from the desktop'
  ],
  [
    'install ok from the CLI, app only',
    {
      kind: 'install',
      action: 'app.install',
      surface: 'cli',
      result: 'ok',
      app: 'com.example.player'
    },
    'Installed com.example.player from the CLI'
  ],
  [
    'reinstall ok from the CLI',
    {
      kind: 'install',
      action: 'app.reinstall',
      surface: 'cli',
      result: 'ok',
      package: 'player_armv7.vpkg',
      app: 'com.example.hellovega'
    },
    'Reinstalled com.example.hellovega from the CLI'
  ],
  [
    'install ok from MCP',
    { kind: 'install', action: 'app.install', surface: 'mcp', result: 'ok', package: 'p.vpkg' },
    'Installed p.vpkg from MCP'
  ],
  [
    'install ok from the GitHub Action',
    { kind: 'install', action: 'app.install', surface: 'action', result: 'ok', package: 'p.vpkg' },
    'Installed p.vpkg from the GitHub Action'
  ],
  [
    'install error',
    {
      kind: 'install',
      action: 'app.install',
      surface: 'cli',
      result: 'error',
      package: 'player_armv7.vpkg',
      errorCode: 'TARGET_OFFLINE'
    },
    'Install of player_armv7.vpkg failed: TARGET_OFFLINE'
  ],
  [
    'reinstall error',
    {
      kind: 'install',
      action: 'app.reinstall',
      surface: 'desktop',
      result: 'error',
      app: 'com.example.player',
      errorCode: 'ARCH_MISMATCH'
    },
    'Reinstall of com.example.player failed: ARCH_MISMATCH'
  ],
  ['restarted', { kind: 'restarted', reason: 'install' }, 'Log session restarted'],
  ['disconnected', { kind: 'disconnected' }, 'Device dropped · reconnecting…'],
  ['reconnected', { kind: 'reconnected' }, 'Log session reconnected'],
  [
    'launch verified',
    {
      kind: 'launch',
      action: 'app.launch',
      surface: 'cli',
      app: 'com.example.player',
      result: 'verified'
    },
    'Launch of com.example.player verified'
  ],
  [
    'restart verified',
    {
      kind: 'launch',
      action: 'app.restart',
      surface: 'desktop',
      app: 'com.example.player',
      result: 'verified'
    },
    'Restart of com.example.player verified'
  ],
  [
    'crash with pid and signal',
    {
      kind: 'launch',
      action: 'app.launch',
      surface: 'cli',
      app: 'com.example.player',
      result: 'crashed',
      pid: 27178,
      signal: 'SIGABRT'
    },
    'Crash detected: com.example.player (pid 27178, SIGABRT)'
  ],
  [
    'crash with pid only',
    {
      kind: 'launch',
      action: 'app.launch',
      surface: 'cli',
      app: 'com.example.player',
      result: 'crashed',
      pid: 27178
    },
    'Crash detected: com.example.player (pid 27178)'
  ],
  [
    'crash with neither',
    {
      kind: 'launch',
      action: 'app.launch',
      surface: 'cli',
      app: 'com.example.player',
      result: 'crashed'
    },
    'Crash detected: com.example.player'
  ],
  [
    'launch not running',
    {
      kind: 'launch',
      action: 'app.launch',
      surface: 'cli',
      app: 'com.example.player',
      result: 'not-running'
    },
    'Launch of com.example.player not verified: it isn’t running'
  ],
  [
    'launch failed',
    {
      kind: 'launch',
      action: 'app.launch',
      surface: 'cli',
      app: 'com.example.player',
      result: 'failed',
      errorCode: 'LAUNCH_FAILED'
    },
    'Launch of com.example.player failed: LAUNCH_FAILED'
  ]
])('ovdEventText: %s', (_name, event, text) => {
  expect(ovdEventText(event)).toBe(text)
})

test('an OVD entry prints time, OVD and the message; paintLevel paints OVD', () => {
  const ovd: LogEntry = {
    seq: 3,
    time: TIME,
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
  expect(logText(ovd)).toBe(`${CLOCK} OVD Log session restarted\n`)
  expect(logText(ovd, { paintLevel: (level, t) => `<${level}:${t}>` })).toBe(
    `${CLOCK} <I:OVD> Log session restarted\n`
  )
})
