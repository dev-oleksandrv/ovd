import { expect, test } from 'vitest'
import { parseVdaUsb } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

test.each(['restarting.txt', 'empty.txt'])('accepts the switch back to USB: %s', (name) => {
  expect(() => parseVdaUsb(fixture(`0.24/vda-usb/${name}`))).not.toThrow()
})

test.each([fixture('0.24/vda-tcpip/restarting.txt'), 'error: closed'])('rejects %j', (out) => {
  expect(() => parseVdaUsb(out)).toThrow(expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' }))
})
