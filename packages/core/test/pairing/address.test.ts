import { describe, expect, test } from 'vitest'
import { onHostNetwork, parseAddress } from '../../src/index.js'

describe('parseAddress', () => {
  test.each([
    ['192.0.2.42', { host: '192.0.2.42', port: 5555, id: '192.0.2.42:5555' }],
    ['192.0.2.42:6000', { host: '192.0.2.42', port: 6000, id: '192.0.2.42:6000' }],
    [' 192.0.2.42:5555 ', { host: '192.0.2.42', port: 5555, id: '192.0.2.42:5555' }],
    ['living-room.local', { host: 'living-room.local', port: 5555, id: 'living-room.local:5555' }]
  ])('%j', (input, expected) => {
    expect(parseAddress(input)).toEqual(expected)
  })

  test.each([
    '',
    '192.0.2.300',
    '192.0.2',
    'not an ip',
    '192.0.2.42:',
    '192.0.2.42:1024',
    '192.0.2.42:99999',
    '192.0.2.42:abc',
    '2001:db8::1'
  ])('rejects %j', (input) => {
    expect(() => parseAddress(input)).toThrow(expect.objectContaining({ code: 'INVALID_ADDRESS' }))
  })
})

describe('onHostNetwork', () => {
  const networks = [{ address: '198.51.100.7', cidr: '198.51.100.7/24' }]

  test.each([
    ['198.51.100.42', true],
    ['192.0.2.42', false],
    ['living-room.local', true]
  ])('%s', (ip, expected) => {
    expect(onHostNetwork(ip, networks)).toBe(expected)
  })

  test('no networks means not on one', () => {
    expect(onHostNetwork('192.0.2.42', [])).toBe(false)
  })
})
