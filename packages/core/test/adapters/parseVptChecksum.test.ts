import { describe, expect, test } from 'vitest'
import { parseVptChecksum } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseVptChecksum', () => {
  test('reads the SHA-384', () => {
    expect(parseVptChecksum(fixture('0.24/vpt-checksum/player-armv7-release.txt'))).toEqual({
      sha384:
        '0ee2046baab98d351fadaa39b6337347fe3390e5734e15055cfd1eef01f6d9c65098b7a2d0d818d02c157d59c195d222'
    })
  })

  test.each(['', 'sha256: 752e4637', 'sha384: nothex'])('rejects %j', (out) => {
    expect(() => parseVptChecksum(out)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})
