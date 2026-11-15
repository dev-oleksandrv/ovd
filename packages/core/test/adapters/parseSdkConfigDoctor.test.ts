import { describe, expect, test } from 'vitest'
import { parseSdkConfigDoctor } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseSdkConfigDoctor', () => {
  test.each(['0.24', '2.0'])('%s/vega-sdk-config-doctor/ok.json', (version) => {
    expect(parseSdkConfigDoctor(fixture(`${version}/vega-sdk-config-doctor/ok.json`))).toEqual({
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
