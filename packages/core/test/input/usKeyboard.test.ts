import { describe, expect, test } from 'vitest'
import { usKey } from '../../src/input/usKeyboard.js'

describe('usKey', () => {
  test.each([
    ['a', 30, false],
    ['A', 30, true],
    ['z', 44, false],
    ['q', 16, false],
    ['1', 2, false],
    ['!', 2, true],
    ['0', 11, false],
    [')', 11, true],
    ['-', 12, false],
    ['_', 12, true],
    ['=', 13, false],
    ['[', 26, false],
    ['}', 27, true],
    [';', 39, false],
    [':', 39, true],
    ["'", 40, false],
    ['"', 40, true],
    ['`', 41, false],
    ['~', 41, true],
    ['\\', 43, false],
    ['|', 43, true],
    [',', 51, false],
    ['<', 51, true],
    ['.', 52, false],
    ['?', 53, true],
    [' ', 57, false]
  ])('%j → %i (shift %s)', (char, code, shift) => {
    expect(usKey(char)).toEqual({ code, shift })
  })

  test('covers every printable ASCII character', () => {
    for (let c = 0x20; c <= 0x7e; c++) expect(usKey(String.fromCharCode(c))).not.toBeNull()
  })

  test.each(['\n', '\t', '\u007f', 'é', '😀', ''])('%j has no key', (char) => {
    expect(usKey(char)).toBeNull()
  })
})
