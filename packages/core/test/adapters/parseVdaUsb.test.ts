import { expect, test } from 'vitest'
import { parseVdaUsb } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

test('accepts the switch back to USB', () => {
  expect(() => parseVdaUsb(fixture('0.24/vda-usb/restarting.txt'))).not.toThrow()
})

test.each(['', fixture('0.24/vda-tcpip/restarting.txt')])('rejects %j', (out) => {
  expect(() => parseVdaUsb(out)).toThrow(expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' }))
})
