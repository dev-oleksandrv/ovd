import { describe, expect, test } from 'vitest'
import { parseVegaVersion } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseVegaVersion', () => {
  test.each([
    ['vega-version/manager.txt', { cli: 'manager', sdkVersion: '0.24.12112', cliVersion: '1.4.5' }],
    ['vega-version/bundled.txt', { cli: 'bundled', sdkVersion: '0.24.12112' }]
  ])('%s', (file, expected) => {
    expect(parseVegaVersion(fixture(`0.24/${file}`))).toEqual(expected)
  })

  test('tolerates CRLF line endings', () => {
    expect(
      parseVegaVersion('Active SDK Version: 0.24.12112\r\nVega CLI Version: 1.4.5\r\n')
    ).toEqual({ cli: 'manager', sdkVersion: '0.24.12112', cliVersion: '1.4.5' })
  })

  test.each(['', 'Vega SDK CLI\n\nUsage: vega', 'command not found'])('rejects %j', (out) => {
    expect(() => parseVegaVersion(out)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})
