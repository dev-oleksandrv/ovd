import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { pngSize } from '../../src/index.js'

const synthetic = new Uint8Array(
  readFileSync(
    new URL('../../../../fixtures/0.24/vda-pull/synthetic-screenshot.png', import.meta.url)
  )
)

const header = (width: number, height: number, type = 'IHDR', length = 13) => {
  const bytes = Buffer.alloc(24)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes, 0)
  bytes.writeUInt32BE(length, 8)
  bytes.write(type, 12, 'latin1')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return new Uint8Array(bytes)
}

describe('pngSize', () => {
  test('the synthetic screenshot is 1920x1080', () => {
    expect(pngSize(synthetic)).toEqual({ width: 1920, height: 1080 })
  })

  test('reads the IHDR size from the first 24 bytes', () => {
    expect(pngSize(header(640, 360))).toEqual({ width: 640, height: 360 })
  })

  test.each([
    ['empty', new Uint8Array()],
    ['short', header(1, 1).subarray(0, 23)],
    ['text', new Uint8Array(Buffer.from('vda: error: failed to stat remote object, and more'))],
    ['no IHDR', header(1, 1, 'IDAT')],
    ['wrong IHDR length', header(1, 1, 'IHDR', 12)],
    ['zero width', header(0, 1)],
    ['zero height', header(1, 0)]
  ])('%s is not a PNG', (_name, bytes) => {
    expect(pngSize(bytes)).toBeNull()
  })
})
