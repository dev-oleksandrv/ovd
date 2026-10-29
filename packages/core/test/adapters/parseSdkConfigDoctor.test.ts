import { describe, expect, test } from 'vitest'
import { parseSdkConfigDoctor } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseSdkConfigDoctor', () => {
  test('vega-sdk-config-doctor/ok.json', () => {
    expect(parseSdkConfigDoctor(fixture('0.24/vega-sdk-config-doctor/ok.json'))).toEqual({
      status: 'success',
      corrupted: 0,
      removed: 0
    })
  })

  test.each(['', 'nope', '{}', '{"status":"success"}'])('rejects %j', (out) => {
    expect(() => parseSdkConfigDoctor(out)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})
