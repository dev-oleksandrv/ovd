import { describe, expect, test } from 'vitest'
import {
  fileName,
  savedToast,
  screenshotBlocker,
  screenshotCli,
  sizeLabel
} from '../../../src/renderer/src/screenshot/screenshotView'
import { stick, vvd, wifiOffline } from '../screens/devices/sample'

describe('screenshotView', () => {
  test('the CLI echo', () => {
    expect(screenshotCli('VirtualDevice')).toBe('ovd screenshot --clipboard --device VirtualDevice')
  })

  test.each([
    ['no target', undefined, 'No target device'],
    ['an online stick', stick, null],
    ['an offline stick', wifiOffline, 'Bedroom stick is offline'],
    ['a stopped Virtual Device', vvd, 'Vega Virtual Device is stopped']
  ])('blocker with %s', (_label, device, reason) => {
    expect(screenshotBlocker(device)).toBe(reason)
  })

  test.each([
    [512, '512 B'],
    [9780, '9.6 KB'],
    [940_000, '918.0 KB'],
    [2_500_000, '2.4 MB']
  ])('%i bytes is %s', (bytes, label) => {
    expect(sizeLabel(bytes)).toBe(label)
  })

  test('the toast names the file, a warning when not copied', () => {
    const shot = {
      target: { id: 'VirtualDevice', name: 'Vega Virtual Device' },
      backend: 'grpc' as const,
      path: '/home/developer/ovd/captures/vega-virtual-device-20261112-021100.png',
      width: 1920,
      height: 1080,
      bytes: 9780,
      takenAt: '2026-11-12T02:11:00.000Z'
    }
    expect(fileName(shot.path)).toBe('vega-virtual-device-20261112-021100.png')
    expect(savedToast({ ...shot, copied: true })).toEqual({
      tone: 'ok',
      text: 'Saved vega-virtual-device-20261112-021100.png · copied to the clipboard'
    })
    expect(savedToast({ ...shot, copied: false }).tone).toBe('warning')
  })
})
