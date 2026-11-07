// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { optionalFlag, requireText } from '../../src/main/guards'

describe('requireText', () => {
  test('returns a non-empty string unchanged', () => {
    expect(requireText('Living room stick', 'name')).toBe('Living room stick')
  })

  test.each([
    ['an empty string', ''],
    ['a number', 42],
    ['undefined', undefined],
    ['null', null],
    ['an object', { name: 'Bedroom stick' }]
  ])('rejects %s and names the field', (_label, value) => {
    expect(() => requireText(value, 'name')).toThrow(
      new TypeError('name must be a non-empty string')
    )
  })
})

describe('optionalFlag', () => {
  test.each([
    ['undefined', undefined, false],
    ['true', true, true],
    ['false', false, false]
  ])('%s → %s', (_label, value, flag) => {
    expect(optionalFlag(value, 'force')).toBe(flag)
  })

  test.each([
    ['a string', 'true'],
    ['a number', 1],
    ['null', null],
    ['an object', { force: true }]
  ])('rejects %s and names the field', (_label, value) => {
    expect(() => optionalFlag(value, 'force')).toThrow(new TypeError('force must be a boolean'))
  })
})
