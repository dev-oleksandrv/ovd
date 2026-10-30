import { expect, test } from 'vitest'
import { parseVdaTcpip } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

test('reads the port', () => {
  expect(parseVdaTcpip(fixture('0.24/vda-tcpip/restarting.txt'))).toEqual({ port: 5555 })
})

test.each(['', fixture('0.24/vda-tcpip/device-not-found.stderr.txt')])('rejects %j', (out) => {
  expect(() => parseVdaTcpip(out)).toThrow(expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' }))
})
