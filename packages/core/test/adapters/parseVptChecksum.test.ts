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

  test('2.0/vpt-checksum/hellovega-x86_64-debug.txt', () => {
    expect(parseVptChecksum(fixture('2.0/vpt-checksum/hellovega-x86_64-debug.txt'))).toEqual({
      sha384:
        '29d2e469122de33419d7b6bedf38de83a6323ca1d13bbf7b85d04044430e4e995868c0667796e1ab18847aac020ee837'
    })
  })

  test.each(['', 'sha256: 752e4637', 'sha384: nothex'])('rejects %j', (out) => {
    expect(() => parseVptChecksum(out)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})
