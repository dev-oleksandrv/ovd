import { describe, expect, test } from 'vitest'
import { parseVdaDevices } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

const stick = {
  vdaSerial: 'G070000000000001',
  state: 'device',
  props: { usb: '17825792X', vda: '2_13_00000000', transport_id: '11' }
}

describe('parseVdaDevices', () => {
  test.each([
    ['vda-devices/none.txt', []],
    ['vda-devices/stick-usb.txt', [stick]],
    [
      'vda-devices/stick-usb-and-virtual-device.txt',
      [stick, { vdaSerial: 'emulator-5554', state: 'device', props: { transport_id: '9' } }]
    ]
  ])('%s', (file, expected) => {
    expect(parseVdaDevices(fixture(`0.24/${file}`))).toEqual(expected)
  })

  test.each(['', 'garbage', fixture('0.24/vda-devices/vda-missing-errno.txt')])(
    'rejects %j',
    (out) => {
      expect(() => parseVdaDevices(out)).toThrow(
        expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
      )
    }
  )
})
