import { describe, expect, test } from 'vitest'
import { parseAppConfig } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseAppConfig', () => {
  test.each([
    ['vpt-dump-app-config/debug.json', 'debug'],
    ['vpt-dump-app-config/release.json', 'release']
  ])('%s', (file, buildType) => {
    expect(parseAppConfig(fixture(`0.24/${file}`))).toEqual({ buildType })
  })

  test.each(['', '{"mainBundle":"index.hermes.bundle"}'])('rejects %j', (out) => {
    expect(() => parseAppConfig(out)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})
