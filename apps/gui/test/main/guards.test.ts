// @vitest-environment node
import { describe, expect, test } from 'vitest'
import {
  logsFilter,
  optionalFlag,
  optionalSeq,
  requireFlag,
  requireText
} from '../../src/main/guards'

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

describe('logsFilter', () => {
  test.each([
    ['an empty filter', {}],
    ['every key', { app: 'com.example.player', level: 'e', search: 'tick', regex: true }],
    ['system', { system: true }]
  ])('accepts %s', (_label, value) => {
    expect(logsFilter(value)).toEqual(value)
  })

  test('drops keys that are undefined', () => {
    expect(logsFilter({ app: undefined, level: 'w' })).toEqual({ level: 'w' })
  })

  test.each([
    ['null', null, 'filter must be an object'],
    ['a string', 'level=e', 'filter must be an object'],
    ['an array', [], 'filter must be an object'],
    ['a numeric level', { level: 4 }, 'filter.level must be a string'],
    ['a string regex', { regex: 'true' }, 'filter.regex must be a boolean'],
    ['an unknown key', { until: '07:30' }, 'filter.until is not a log filter']
  ])('rejects %s', (_label, value, message) => {
    expect(() => logsFilter(value)).toThrow(new TypeError(message))
  })
})

describe('optionalSeq', () => {
  test.each([
    [undefined, undefined],
    [0, 0],
    [42, 42]
  ])('%s → %s', (value, seq) => {
    expect(optionalSeq(value)).toBe(seq)
  })

  test.each([
    ['-1', -1],
    ['1.5', 1.5],
    ['a string', '3'],
    ['null', null]
  ])('rejects %s', (_label, value) => {
    expect(() => optionalSeq(value)).toThrow(TypeError)
  })
})

describe('requireFlag', () => {
  test.each([true, false])('%s is returned as is', (value) => {
    expect(requireFlag(value, 'on')).toBe(value)
  })

  test.each([
    ['undefined', undefined],
    ['a string', 'true'],
    ['a number', 1],
    ['null', null]
  ])('%s is a TypeError', (_label, value) => {
    expect(() => requireFlag(value, 'on')).toThrow(new TypeError('on must be a boolean'))
  })
})
