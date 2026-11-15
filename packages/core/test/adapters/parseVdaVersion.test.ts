import { describe, expect, test } from 'vitest'
import { parseVdaVersion } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseVdaVersion', () => {
  test.each([
    ['0.24', '2.6+3d072013'],
    ['2.0', '2.13+eb3ab1a5']
  ])('%s/vda-version/ok.txt', (sdk, version) => {
    expect(parseVdaVersion(fixture(`${sdk}/vda-version/ok.txt`))).toEqual({ version })
  })

  test.each(['', 'error: no devices/emulators found'])('rejects %j', (out) => {
    expect(() => parseVdaVersion(out)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})
