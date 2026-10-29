import { describe, expect, test } from 'vitest'
import { parseVvdStatus } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseVvdStatus', () => {
  test.each([
    ['vega-virtual-device-status/running.json', { running: true }],
    ['vega-virtual-device-status/stopped.json', { running: false }]
  ])('%s', (file, expected) => {
    expect(parseVvdStatus(fixture(`0.24/${file}`))).toEqual(expected)
  })

  test.each(['', 'Virtual device ready.', '{"running":"yes"}'])('rejects %j', (out) => {
    expect(() => parseVvdStatus(out)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})
