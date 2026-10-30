import { describe, expect, test } from 'vitest'
import { parseVdaConnect } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseVdaConnect', () => {
  test.each([
    ['connected.txt', { result: 'connected', id: '192.0.2.42:5555' }],
    ['already-connected.txt', { result: 'connected', id: '192.0.2.42:5555' }],
    ['refused.txt', { result: 'refused' }],
    ['timed-out.txt', { result: 'timed-out' }],
    ['bad-port.txt', { result: 'bad-address' }],
    ['bad-host.txt', { result: 'bad-address' }]
  ])('%s', (file, expected) => {
    expect(parseVdaConnect(fixture(`0.24/vda-connect/${file}`))).toMatchObject(expected)
  })

  test.each(['', 'List of devices attached'])('rejects %j', (out) => {
    expect(() => parseVdaConnect(out)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})
