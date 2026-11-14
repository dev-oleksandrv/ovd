import { describe, expect, test } from 'vitest'
import { assertSafeRegex, MAX_REGEX_CHARS } from '../../src/logs/safeRegex.js'

const rejects = (pattern: string) =>
  expect(() => assertSafeRegex(pattern)).toThrow(
    expect.objectContaining({ code: 'INVALID_LOG_FILTER' })
  )

describe('assertSafeRegex: refused', () => {
  test.each([
    // A quantified group that contains a quantifier or an alternation.
    '(a+)+$',
    '(a*)*',
    '(a|aa)+',
    '(.*a){3,}',
    '(?:a+)*',
    '((a+))+',
    '((a+)b)*',
    '(a+b?){2,5}',
    '(a?)+',
    '(\\w+\\s?)+$',
    '(x{2,})*',
    '(foo|foobar)*',
    '(a+)+?',
    '(?<name>a+)+',
    '(?=a+)*b'
  ])('nested quantifier %s', rejects)

  test.each(['(a)\\1', '(a)(b)\\2', 'x\\10', '(?<n>a)\\k<n>', '\\1'])('backreference %s', rejects)

  test.each(['(?<=a)b', '(?<!a)b', 'x(?<=\\d)y'])('lookbehind %s', rejects)

  test('a pattern over the length limit', () => {
    rejects('a'.repeat(MAX_REGEX_CHARS + 1))
  })
})

describe('assertSafeRegex: accepted', () => {
  test.each([
    'error',
    'a+b+',
    '^\\d+ items',
    '[a-z]+@[a-z]+',
    '(ab)+',
    '(?:ab)+',
    '(abc){2,3}',
    '(a+)?',
    '(a+){0,1}',
    '(foo|bar)?x',
    '(error|warn|fatal)',
    '\\b(?:http|https|fetch)\\b',
    '(?=a+)b',
    '(?<name>ab)+',
    // A backslash then a digit inside a class is an octal escape, not a backreference.
    '[\\1]+',
    // An escaped paren or quantifier is a literal.
    '\\(a+\\)+',
    'a\\+\\+',
    // `{` that isn't a quantifier is a literal.
    '(a{x})+',
    'a{,3}',
    '\\0'
  ])('%s', (pattern) => {
    expect(() => assertSafeRegex(pattern)).not.toThrow()
  })

  test('exactly at the length limit', () => {
    expect(() => assertSafeRegex('a'.repeat(MAX_REGEX_CHARS))).not.toThrow()
  })
})

describe('assertSafeRegex: the safe neighbours of the refused patterns finish fast', () => {
  // The same line hurts `(a+)+$` for minutes: it ends with a char that fails every attempt.
  const hostile = `${'a'.repeat(4_095)}!`

  test.each(['(ab)+$', 'a+b', '(?:aa)+b', '(a|b)?c', '^(a+)?b', '(abc){2,3}$'])('%s', (pattern) => {
    assertSafeRegex(pattern)
    const regex = new RegExp(pattern, 'i')
    const started = performance.now()
    regex.test(hostile)
    expect(performance.now() - started).toBeLessThan(50)
  })
})
