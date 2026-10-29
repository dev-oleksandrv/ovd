import type { Device } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import {
  dimmed,
  infoRows,
  kindLabel,
  serialLine,
  statusView,
  subtitle
} from '../../../../src/renderer/src/screens/devices/deviceView'
import { stick, vvd, wifiOffline } from './sample'

describe('statusView', () => {
  test.each<[Device['status'], ReturnType<typeof statusView>]>([
    ['online', { label: 'Online', tone: 'ok', pulse: false }],
    ['offline', { label: 'Offline', tone: 'muted', pulse: false }],
    ['stopped', { label: 'Stopped', tone: 'muted', pulse: false }],
    ['starting', { label: 'Starting…', tone: 'warning', pulse: true }]
  ])('%s', (status, expected) => {
    expect(statusView({ ...stick, status })).toEqual(expected)
  })
})

describe('labels', () => {
  test.each([
    [stick, 'USB · armv7 · OS 2.0', 'Fire TV stick', false],
    [vvd, 'Local', 'Vega Virtual Device', true],
    [wifiOffline, 'Wi-Fi', 'Fire TV stick', true]
  ])('%#', (device, sub, kind, dim) => {
    expect(subtitle(device)).toBe(sub)
    expect(kindLabel(device)).toBe(kind)
    expect(dimmed(device)).toBe(dim)
  })
})

describe('infoRows', () => {
  test('an online stick shows every row', () => {
    expect(infoRows(stick)).toEqual([
      { label: 'OS', value: 'OS 2.0' },
      { label: 'Build', value: 'TV Ship/529', mono: true },
      { label: 'Architecture', value: 'armv7', mono: true },
      { label: 'Profile', value: 'tv', mono: true },
      { label: 'Connection', value: 'USB' },
      { label: 'Serial', value: 'G070000000000001', mono: true }
    ])
  })

  test('a Wi-Fi device shows its IP and only what is known', () => {
    expect(infoRows(wifiOffline)).toEqual([
      { label: 'Connection', value: 'Wi-Fi · 192.0.2.77' },
      { label: 'Serial', value: 'G070000000000002', mono: true }
    ])
  })
})

describe('serialLine', () => {
  test.each([
    [wifiOffline, 'Serial G070000000000002 · vda get-serialno'],
    [stick, null],
    [{ ...wifiOffline, serial: undefined }, null]
  ] as [Device, string | null][])('%#', (device, expected) => {
    expect(serialLine(device)).toBe(expected)
  })
})
