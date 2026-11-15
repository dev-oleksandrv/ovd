import { describe, expect, test } from 'vitest'
import { parseBootId } from '../../src/adapters/parseBootId.js'
import { fixture } from '../support/fixtures.js'

// The sample ID of ADR 0016: a fake UUID, as `cat /proc/sys/kernel/random/boot_id` prints it
// (ARCHITECTURE §8).
const DASHED = '0b6a5f2e-3c41-4d7a-9e58-1f2a3b4c5d6e'
const BARE = '0b6a5f2e3c414d7a9e581f2a3b4c5d6e'

describe('parseBootId', () => {
  test.each([
    [`${DASHED}\n`, BARE],
    [`${DASHED}\r\n`, BARE],
    [DASHED.toUpperCase(), BARE],
    [`  ${DASHED}  \n`, BARE]
  ])('%j gives the ID without dashes, lower case', (out, expected) => {
    expect(parseBootId(out)).toBe(expected)
  })

  test.each(['0.24', '2.0'])('%s/vda-shell/boot-id.txt', (sdk) => {
    expect(parseBootId(fixture(`${sdk}/vda-shell/boot-id.txt`))).toBe(
      '00000000000040008000000000000001'
    )
  })

  test.each([
    '',
    '\n',
    BARE,
    `${DASHED}\nextra`,
    `${DASHED}0`,
    '0b6a5f2e-3c41-4d7a-9e58-1f2a3b4c5d6',
    '0b6a5f2e-3c41-4d7a-9e58-1f2a3b4c5dzz',
    'cat: /proc/sys/kernel/random/boot_id: No such file or directory'
  ])('rejects %j', (out) => {
    expect(() => parseBootId(out)).toThrow(expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' }))
  })
})
