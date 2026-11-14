import { describe, expect, test } from 'vitest'
import { bytesText } from '../../src/format/logsBundle.js'
import { filterSummary } from '../../src/format/logsFilter.js'

describe('filterSummary', () => {
  test('an empty filter reads as everything', () => {
    expect(filterSummary({})).toBe('everything')
  })

  test('every field reads as the flag that makes it', () => {
    expect(
      filterSummary({
        app: 'com.example.player',
        level: 'warn',
        search: 'two words',
        regex: true,
        pid: [1, '2'],
        tag: ['t'],
        boot: ['current'],
        processRules: [
          { identity: 'a', mute: true },
          { identity: 'b', level: 'E', rate: 5 }
        ]
      })
    ).toBe(
      "--app com.example.player --level warn --grep 'two words' --regex --pid 1 --pid 2 --tag t " +
        '--boot current --mute a --process-level b=E --process-rate b=5'
    )
  })

  test('control characters are escaped', () => {
    expect(filterSummary({ tag: ['a\u001b[31m'] })).toBe("--tag 'a\\x1b[31m'")
  })
})

test('bytesText', () => {
  expect([bytesText(10), bytesText(2048), bytesText(3 * 1024 * 1024)]).toEqual([
    '10 B',
    '2.0 KB',
    '3.0 MB'
  ])
})
