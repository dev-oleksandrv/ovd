import { describe, expect, test } from 'vitest'
import { parseVsmDeveloperMode, parseVsmDeveloperModeSet } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseVsmDeveloperMode', () => {
  test.each([
    ['vsm-developer-mode/enabled.txt', { enabled: true }],
    ['vsm-developer-mode/disabled.txt', { enabled: false }]
  ])('%s', (file, expected) => {
    expect(parseVsmDeveloperMode(fixture(`0.24/${file}`))).toEqual(expected)
  })

  test.each(['', 'enabled', fixture('0.24/vsm-developer-mode/shell-service-down.stderr.txt')])(
    'rejects %j',
    (out) => {
      expect(() => parseVsmDeveloperMode(out)).toThrow(
        expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
      )
    }
  )
})

describe('parseVsmDeveloperModeSet', () => {
  test.each([
    ['vsm-developer-mode-set/enabled.txt', { enabled: true }],
    ['vsm-developer-mode-set/disabled.txt', { enabled: false }]
  ])('%s', (file, expected) => {
    expect(parseVsmDeveloperModeSet(fixture(`0.24/${file}`))).toEqual(expected)
  })

  test.each(['', 'developer-mode: enable'])('rejects %j', (out) => {
    expect(() => parseVsmDeveloperModeSet(out)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})
