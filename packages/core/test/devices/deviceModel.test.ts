import { describe, expect, test } from 'vitest'
import { canonicalId, classifyVdaEntry, defaultName, parseVdaDevices } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

const [stick, vvd] = parseVdaDevices(fixture('0.24/vda-devices/stick-usb-and-virtual-device.txt'))

describe('classifyVdaEntry', () => {
  test.each([
    ['recorded USB stick', stick, { id: 'G070000000000001', kind: 'stick', connection: 'usb' }],
    ['recorded Virtual Device', vvd, { id: 'VirtualDevice', kind: 'vvd', connection: 'local' }],
    [
      'Wi-Fi ID',
      { vdaSerial: '192.0.2.42:5555', state: 'device', props: {} },
      { id: '192.0.2.42:5555', kind: 'stick', connection: 'wifi', ip: '192.0.2.42' }
    ],
    [
      'unknown shape falls back to USB',
      { vdaSerial: 'G070000000000002', state: 'offline', props: {} },
      { id: 'G070000000000002', kind: 'stick', connection: 'usb' }
    ]
  ])('%s', (_, entry, expected) => {
    expect(classifyVdaEntry(entry!)).toEqual(expected)
  })
})

describe('canonicalId', () => {
  test.each([
    ['emulator-5554', 'VirtualDevice'],
    ['emulator-5556', 'VirtualDevice'],
    ['VirtualDevice', 'VirtualDevice'],
    ['G070000000000001', 'G070000000000001'],
    ['192.0.2.42:5555', '192.0.2.42:5555']
  ])('%s → %s', (id, expected) => {
    expect(canonicalId(id)).toBe(expected)
  })
})

describe('defaultName', () => {
  test.each([
    ['stick', 'G070000000000001', ['G070000000000001'], 'Fire TV stick'],
    ['stick', 'G070000000000001', ['G070000000000001', 'G070000000000002'], 'Fire TV stick 0001'],
    ['stick', 'G070000000000001', ['G070000000000001', 'G070000000000001'], 'Fire TV stick'],
    ['vvd', 'VirtualDevice', ['G070000000000001', 'G070000000000002'], 'Vega Virtual Device']
  ] as const)('%s %s among %j → %s', (kind, serial, sticks, expected) => {
    expect(defaultName(kind, serial, [...sticks])).toBe(expected)
  })
})
