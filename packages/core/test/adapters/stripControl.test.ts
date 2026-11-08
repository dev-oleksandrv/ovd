import { describe, expect, test } from 'vitest'
import { stripControl } from '../../src/adapters/stripControl.js'

describe('stripControl', () => {
  test.each([
    ['an SGR colour (ESC [)', '\u001b[31mred\u001b[0m', '[31mred[0m'],
    [
      'an OSC 8 link (ESC ], BEL)',
      '\u001b]8;;https://example.com\u0007x\u001b]8;;\u0007',
      ']8;;https://example.comx]8;;'
    ],
    ['an OSC title ended by ESC \\', '\u001b]0;pwned\u001b\\', ']0;pwned\\'],
    ['a C1 CSI', '\u009b2Jcleared', '2Jcleared'],
    ['a C1 OSC and ST', '\u009d0;pwned\u009c', '0;pwned'],
    ['NUL, BS, CR and DEL', 'a\u0000b\bc\rd\u007fe', 'abcde'],
    ['a tab survives', 'key:\tvalue', 'key:\tvalue'],
    ['plain text and non-ASCII', 'Verifying… é ü', 'Verifying… é ü']
  ])('%s', (_name, input, expected) => {
    expect(stripControl(input)).toBe(expected)
  })
})
