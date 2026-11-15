import { describe, expect, test } from 'vitest'
import { parseAppConfig } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseAppConfig', () => {
  test.each([
    ['0.24/vpt-dump-app-config/debug.json', 'debug'],
    ['0.24/vpt-dump-app-config/release.json', 'release'],
    ['2.0/vpt-dump-app-config/hellovega-debug.json', 'debug']
  ])('%s', (file, buildType) => {
    expect(parseAppConfig(fixture(file))).toEqual({ buildType })
  })

  test.each(['', '{"mainBundle":"index.hermes.bundle"}'])('rejects %j', (out) => {
    expect(() => parseAppConfig(out)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})
