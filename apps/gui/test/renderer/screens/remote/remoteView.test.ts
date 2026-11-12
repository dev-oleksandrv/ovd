import { describe, expect, test } from 'vitest'
import type { InputState } from '../../../../src/preload/api'
import {
  backendLabel,
  HOME_UNSUPPORTED,
  keyDisabledReason,
  remoteView
} from '../../../../src/renderer/src/screens/remote/remoteView'
import { stick, vvd, wifiOffline } from '../devices/sample'

const idle: InputState = { status: 'idle', target: null, backend: null, sent: [] }
const forStick = (status: InputState['status']): InputState => ({
  status,
  target: { id: stick.id, name: stick.name },
  backend: status === 'ready' ? 'inputd-cli' : null,
  sent: [],
  ...(status === 'error' ? { error: { code: 'INPUT_FAILED', message: 'x', hint: 'y' } } : {})
})

describe('remoteView', () => {
  test.each([
    ['no target', undefined, idle, 'no-target'],
    ['an offline stick', wifiOffline, idle, 'offline'],
    ['a stopped Virtual Device', vvd, idle, 'offline'],
    ['an online stick with no session yet', stick, idle, 'loading'],
    ['an online stick whose session opens', stick, forStick('opening'), 'loading'],
    ['an online stick whose session failed', stick, forStick('error'), 'error'],
    ['an online stick with a session', stick, forStick('ready'), 'ready'],
    [
      'a session for another device',
      { ...vvd, status: 'online' as const },
      forStick('ready'),
      'loading'
    ]
  ])('%s → %s', (_name, target, state, kind) => {
    expect(remoteView(target, state).kind).toBe(kind)
  })

  test('offline names the device', () => {
    expect(remoteView(wifiOffline, idle)).toEqual({ kind: 'offline', name: 'Bedroom stick' })
  })
})

describe('keys and backends', () => {
  test.each([
    ['home', 'grpc', HOME_UNSUPPORTED],
    ['home', 'inputd-cli', null],
    ['ok', 'grpc', null],
    ['home', null, null]
  ] as const)('%s on %s', (key, backend, reason) => {
    expect(keyDisabledReason(key, backend)).toBe(reason)
  })

  test('labels', () => {
    expect(backendLabel('grpc')).toBe('Emulator gRPC')
    expect(backendLabel('inputd-cli')).toBe('inputd-cli')
  })
})
