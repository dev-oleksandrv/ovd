import type { Device, ScreenshotResult } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import type { ScreenState } from '../../../../src/preload/api'
import {
  drawable,
  latestLabel,
  noSignalText,
  refreshCli,
  screenView
} from '../../../../src/renderer/src/screens/remote/screenPanelView'
import { stick, vvd } from '../devices/sample'

const onlineVvd: Device = { ...vvd, status: 'online', vdaSerial: 'emulator-5554' }
const target = { id: onlineVvd.id, name: onlineVvd.name }
const none = { shot: null, stale: false }
const shot: ScreenshotResult = {
  target: { id: stick.id, name: stick.name },
  backend: 'gwsi-tool-screenshooter',
  path: '/captures/fire-tv-stick-20261112-021100.png',
  width: 1920,
  height: 1080,
  bytes: 9780,
  takenAt: '2026-11-12T02:11:00.000Z'
}
const state = (s: Partial<ScreenState>): ScreenState => ({ status: 'idle', target, ...s })

describe('screenView', () => {
  test.each<[string, Device, ScreenState, ReturnType<typeof screenView>]>([
    ['live', onlineVvd, state({ status: 'live' }), { kind: 'live' }],
    [
      'connecting',
      onlineVvd,
      state({ status: 'connecting' }),
      { kind: 'connecting', name: 'Vega Virtual Device' }
    ],
    // Main's state for another device doesn't count.
    [
      'live for another device',
      onlineVvd,
      state({ status: 'live', target: { id: 'emulator-5556', name: 'x' } }),
      { kind: 'connecting', name: 'Vega Virtual Device' }
    ],
    [
      'error',
      onlineVvd,
      state({ status: 'error', error: { code: 'VVD_GRPC_FAILED', message: 'm', hint: 'h' } }),
      { kind: 'error', error: { code: 'VVD_GRPC_FAILED', message: 'm', hint: 'h' } }
    ],
    [
      'main says no signal',
      onlineVvd,
      state({ status: 'no-signal' }),
      { kind: 'no-signal', name: 'Vega Virtual Device', status: 'offline' }
    ],
    [
      'stopped',
      vvd,
      state({ status: 'live' }),
      { kind: 'no-signal', name: 'Vega Virtual Device', status: 'stopped' }
    ],
    [
      'starting: waited for',
      { ...vvd, status: 'starting' },
      state({ status: 'no-signal' }),
      { kind: 'waiting', name: 'Vega Virtual Device' }
    ],
    [
      'offline stick',
      { ...stick, status: 'offline' },
      state({}),
      { kind: 'no-signal', name: 'Fire TV stick', status: 'offline' }
    ],
    ['online stick', stick, state({}), { kind: 'stick', shot: null, stale: false }]
  ])('%s', (_name, device, live, expected) => {
    expect(screenView(device, live, none)).toEqual(expected)
  })

  test('a stick carries its shot and whether it is out of date', () => {
    expect(screenView(stick, state({}), { shot, stale: true })).toEqual({
      kind: 'stick',
      shot,
      stale: true
    })
  })
})

describe('copy and checks', () => {
  test('noSignalText', () => {
    expect(noSignalText('Bedroom stick', 'offline')).toBe('Bedroom stick is offline')
    expect(noSignalText('Vega Virtual Device', 'stopped')).toBe('Vega Virtual Device is stopped')
  })

  test('refreshCli is what Refresh runs', () => {
    expect(refreshCli(stick.id)).toBe(`ovd screenshot --device ${stick.id}`)
  })

  test('latestLabel is local HH:MM:SS', () => {
    const at = new Date(2026, 10, 12, 4, 5, 6).toISOString()
    expect(latestLabel(at)).toBe('Latest screenshot · 04:05:06')
  })

  test.each([
    [{ width: 1, height: 1, pixels: new Uint8Array(4) }, true],
    [{ width: 2, height: 1, pixels: new Uint8Array(4) }, false],
    [{ width: 0, height: 0, pixels: new Uint8Array(0) }, false],
    [{ width: 1.5, height: 2, pixels: new Uint8Array(12) }, false]
  ])('drawable %#', (frame, ok) => {
    expect(drawable({ seq: 1, timestampUs: 0, ...frame })).toBe(ok)
  })
})
