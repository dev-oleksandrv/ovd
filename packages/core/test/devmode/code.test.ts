import { expect, test } from 'vitest'
import { normalizeCode } from '../../src/index.js'

test.each([
  ['ABC123', 'ABC123'],
  ['abc123', 'ABC123'],
  ['ABC-123', 'ABC123'],
  [' 4a1 b2c ', '4A1B2C']
])('%j → %s', (input, code) => {
  expect(normalizeCode(input)).toBe(code)
})

test.each(['', 'ABC12', 'ABC1234', 'ABC_12', 'ÄBC123'])('%j is INVALID_CODE', (input) => {
  expect(() => normalizeCode(input)).toThrow(expect.objectContaining({ code: 'INVALID_CODE' }))
})
