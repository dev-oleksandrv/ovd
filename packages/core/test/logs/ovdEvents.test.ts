import { expect, test } from 'vitest'
import type { ActivityEntry } from '../../src/index.js'
import { ovdEntry, ovdEventOf } from '../../src/logs/ovdEvents.js'
import type { OvdEvent } from '../../src/logs/types.js'

const TIME = '2026-11-08T12:00:00.000Z'
const STICK = 'G070000000000001'
const PLAYER = 'com.example.player'
const at = (over: Partial<ActivityEntry> & Pick<ActivityEntry, 'action'>): ActivityEntry => ({
  time: TIME,
  surface: 'cli',
  target: STICK,
  args: {},
  result: 'ok',
  ...over
})

test.each<[string, ActivityEntry, OvdEvent | undefined]>([
  [
    'install ok from the desktop',
    at({ action: 'app.install', surface: 'desktop', args: { package: 'player_armv7.vpkg' } }),
    {
      kind: 'install',
      action: 'app.install',
      surface: 'desktop',
      result: 'ok',
      package: 'player_armv7.vpkg'
    }
  ],
  [
    'install ok from the CLI',
    at({ action: 'app.install', args: { package: 'player_armv7.vpkg', force: 'true' } }),
    {
      kind: 'install',
      action: 'app.install',
      surface: 'cli',
      result: 'ok',
      package: 'player_armv7.vpkg'
    }
  ],
  [
    'reinstall ok',
    at({ action: 'app.reinstall', args: { app: PLAYER, package: 'player_armv7.vpkg' } }),
    {
      kind: 'install',
      action: 'app.reinstall',
      surface: 'cli',
      result: 'ok',
      package: 'player_armv7.vpkg',
      app: PLAYER
    }
  ],
  [
    'install error TARGET_OFFLINE',
    at({
      action: 'app.install',
      args: { package: 'player_armv7.vpkg' },
      result: 'error',
      errorCode: 'TARGET_OFFLINE'
    }),
    {
      kind: 'install',
      action: 'app.install',
      surface: 'cli',
      result: 'error',
      package: 'player_armv7.vpkg',
      errorCode: 'TARGET_OFFLINE'
    }
  ],
  [
    'launch ok',
    at({ action: 'app.launch', args: { app: PLAYER } }),
    { kind: 'launch', action: 'app.launch', surface: 'cli', app: PLAYER, result: 'verified' }
  ],
  [
    'restart crashed with pid and signal',
    at({
      action: 'app.restart',
      surface: 'desktop',
      args: { app: PLAYER, reason: 'crashed', pid: '27178', signal: 'SIGABRT' },
      result: 'error',
      errorCode: 'LAUNCH_NOT_VERIFIED'
    }),
    {
      kind: 'launch',
      action: 'app.restart',
      surface: 'desktop',
      app: PLAYER,
      result: 'crashed',
      pid: 27178,
      signal: 'SIGABRT'
    }
  ],
  [
    'launch not running',
    at({
      action: 'app.launch',
      args: { app: PLAYER, reason: 'not-running' },
      result: 'error',
      errorCode: 'LAUNCH_NOT_VERIFIED'
    }),
    { kind: 'launch', action: 'app.launch', surface: 'cli', app: PLAYER, result: 'not-running' }
  ],
  [
    'launch LAUNCH_FAILED',
    at({
      action: 'app.launch',
      args: { app: PLAYER },
      result: 'error',
      errorCode: 'LAUNCH_FAILED'
    }),
    {
      kind: 'launch',
      action: 'app.launch',
      surface: 'cli',
      app: PLAYER,
      result: 'failed',
      errorCode: 'LAUNCH_FAILED'
    }
  ],
  ['logs', at({ action: 'logs' }), undefined],
  ['logs.restart', at({ action: 'logs.restart', args: { reason: 'install' } }), undefined],
  ['app.uninstall', at({ action: 'app.uninstall', args: { app: PLAYER } }), undefined]
])('ovdEventOf: %s', (_name, entry, event) => {
  expect(ovdEventOf(entry)).toEqual(event)
})

test('ovdEntry builds an OVD line with no device fields', () => {
  expect(ovdEntry({ kind: 'restarted', reason: 'install' }, TIME, 7)).toEqual({
    seq: 7,
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
  })
})
