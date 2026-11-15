import { describe, expect, test } from 'vitest'
import { parseDeviceInfo } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseDeviceInfo', () => {
  test.each([
    [
      'vega-device-info/stick-usb.json',
      {
        os: 'OS 2.0',
        build: 'TV Ship/529',
        architecture: 'armv7',
        profile: 'tv',
        product: 'callie',
        simulated: false,
        developerMode: true
      }
    ],
    [
      'vega-device-info/virtual-device.json',
      {
        os: 'OS 1.2',
        build: 'TV Ship/102282480',
        architecture: 'aarch64',
        profile: 'tv',
        product: 'vvrp-tv-arm64',
        simulated: true,
        developerMode: true
      }
    ],
    [
      'vega-device-info/virtual-device-developer-mode-off.json',
      { architecture: 'aarch64', simulated: true, developerMode: false }
    ]
  ])('%s', (file, expected) => {
    expect(parseDeviceInfo(fixture(`0.24/${file}`))).toMatchObject(expected)
  })

  // SDK 2.0 on a Linux x86_64 host: `os` is `vega`, the OS version is in `buildDescription`.
  test('2.0/vega-device-info/virtual-device.json', () => {
    expect(parseDeviceInfo(fixture('2.0/vega-device-info/virtual-device.json'))).toMatchObject({
      os: 'OS 2.0',
      build: 'TV Ship/102815880',
      architecture: 'x86_64',
      profile: 'tv',
      product: 'vvrp-tv-x64',
      simulated: true,
      developerMode: true
    })
  })

  test('keeps the raw document for the detail view', () => {
    const text = fixture('0.24/vega-device-info/stick-usb.json')
    expect(parseDeviceInfo(text).raw).toEqual(JSON.parse(text))
  })

  test('an empty architecture means the device is not readable yet', () => {
    expect(() => parseDeviceInfo(fixture('0.24/vega-device-info/unavailable.json'))).toThrow(
      expect.objectContaining({ code: 'DEVICE_INFO_UNAVAILABLE' })
    )
  })

  test.each(['', 'not json', '[]', '{"architecture":42}'])('rejects %j', (out) => {
    expect(() => parseDeviceInfo(out)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})
