import { describe, expect, test } from 'vitest'
import { parseIsPortForwarded } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseIsPortForwarded', () => {
  test.each([
    [fixture('0.24/vega-device-is-port-forwarded/false.txt'), false],
    ['true\n', true]
  ])('%j', (out, expected) => {
    expect(parseIsPortForwarded(out)).toBe(expected)
  })

  test.each(['', 'yes'])('rejects %j', (out) => {
    expect(() => parseIsPortForwarded(out)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})
