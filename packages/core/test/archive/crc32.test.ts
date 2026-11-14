import { describe, expect, test } from 'vitest'
import { crc32 } from '../../src/archive/crc32.js'

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('crc32', () => {
  test.each([
    ['', 0x00000000],
    ['a', 0xe8b7be43],
    ['abc', 0x352441c2],
    ['123456789', 0xcbf43926],
    ['The quick brown fox jumps over the lazy dog', 0x414fa339]
  ])('vector %j', (text, expected) => {
    expect(crc32(bytes(text))).toBe(expected)
  })

  test('returns an unsigned 32-bit number', () => {
    const value = crc32(new Uint8Array(64).fill(0xff))
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThanOrEqual(0xffffffff)
    expect(Number.isInteger(value)).toBe(true)
  })

  test('can be continued from a previous value', () => {
    const whole = crc32(bytes('123456789'))
    const split = crc32(bytes('56789'), crc32(bytes('1234')))
    expect(split).toBe(whole)
  })

  test('matches zlib.crc32 when the runtime has it', async () => {
    const zlib = (await import('node:zlib')) as { crc32?: (data: Uint8Array) => number }
    if (zlib.crc32 === undefined) return
    const data = new Uint8Array(5000).map((_, i) => (i * 31 + 7) & 0xff)
    expect(crc32(data)).toBe(zlib.crc32(data))
  })
})
