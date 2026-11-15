import { describe, expect, test } from 'vitest'
import { assertSafeRegex, MAX_REGEX_CHARS } from '../../src/logs/safeRegex.js'
import { costVsBaseline, MAX_COST_VS_BASELINE } from '../support/regexCost.js'

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

  test.each([
    // Ranges that multiply past the backtracking bound.
    '.*a.*b',
    '.{0,1000}a.{0,1000}b',
    'a+b+',
    '.*a.*b.*c',
    'a{0,16}'.repeat(8) + 'b',
    '^' + 'a{0,16}'.repeat(10) + 'b$'
  ])('ranges multiply past the bound: %s', rejects)

  test.each([
    // Long brace quantifiers can't hide a repeat from the scan.
    '(a+){00000000000000000000000000000000002,}$',
    '(a+){0000000000000000000000000000000000000000001,3}',
    // Chained overlapping repeats: polynomial of a high degree.
    'a*a*a*a*a*a*a*a*b',
    '^a*a*a*a*a*a*b$',
    'a+a+a+a+b',
    // Three already take seconds on a 4096-character line.
    '.*a.*b.*c',
    'a{1,}a{1,}a{1,}a*b',
    // A count over the limit.
    'a{1001}',
    'a{1,1001}',
    'a{0000000000000000000000000000000001001,}'
  ])('brace and chained repeats: %s', rejects)

  test('a pattern over the length limit', () => {
    rejects('a'.repeat(MAX_REGEX_CHARS + 1))
  })
})

// Shared with the cost check below: every accepted pattern must also be cheap to run.
const ACCEPTED = [
  'error',
  'a+b',
  '^\\d+ items',
  '[a-z]+@',
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
  '.*a',
  'a?b?c?d?',
  'error.*timeout',
  'a{1,16}b{1,16}',
  '^fetch (ok|failed)',
  // A backslash then a digit inside a class is an octal escape, not a backreference.
  '[\\1]+',
  // An escaped paren or quantifier is a literal.
  '\\(a+\\)',
  'a\\+\\+',
  // `{` that isn't a quantifier is a literal.
  '(a{x})+',
  'a{,3}',
  '\\0',
  // A big but bounded count is fine.
  'a{1000}',
  'a{0000000000000000000000000000000002}'
]

describe('assertSafeRegex: accepted', () => {
  test.each(ACCEPTED)('%s', (pattern) => {
    expect(() => assertSafeRegex(pattern)).not.toThrow()
  })

  test('exactly at the length limit', () => {
    expect(() => assertSafeRegex('a'.repeat(MAX_REGEX_CHARS))).not.toThrow()
  })
})

describe('assertSafeRegex: the safe neighbours of the refused patterns cost about one open-ended repeat', () => {
  // The same line hurts `(a+)+$` for minutes: it ends with a char that fails every attempt.
  const hostile = `${'a'.repeat(4_095)}!`

  test.each(['(ab)+$', 'a+b', '(?:aa)+b', '(a|b)?c', '^(a+)?b', '(abc){2,3}$'])('%s', (pattern) => {
    assertSafeRegex(pattern)
    const regex = new RegExp(pattern, 'i')
    expect(costVsBaseline(hostile, () => regex.test(hostile))).toBeLessThan(MAX_COST_VS_BASELINE)
  })
})

describe('assertSafeRegex: every accepted pattern costs about one open-ended repeat on a hostile line', () => {
  const hostile = `${'a'.repeat(4_095)}!`
  test.each(ACCEPTED.filter((pattern) => pattern.length < 400))('%s', (pattern) => {
    const regex = new RegExp(pattern, 'i')
    expect(costVsBaseline(hostile, () => regex.test(hostile))).toBeLessThan(MAX_COST_VS_BASELINE)
  })
})

describe('assertSafeRegex: the cost check catches what the guard refuses', () => {
  // Cubic, so on the 4096-character line it runs for minutes; a short line keeps the test fast
  // and still puts it far past the bound.
  const short = `${'a'.repeat(255)}!`

  test('.*a.*b', () => {
    rejects('.*a.*b')
    expect(costVsBaseline(short, () => /.*a.*b/i.test(short))).toBeGreaterThan(MAX_COST_VS_BASELINE)
  })
})
