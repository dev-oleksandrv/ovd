import { describe, expect, test } from 'vitest'
import { parseVdaVersion } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseVdaVersion', () => {
  test('vda-version/ok.txt', () => {
    expect(parseVdaVersion(fixture('0.24/vda-version/ok.txt'))).toEqual({
      version: '2.6+3d072013'
    })
  })

  test.each(['', 'error: no devices/emulators found'])('rejects %j', (out) => {
    expect(() => parseVdaVersion(out)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})
