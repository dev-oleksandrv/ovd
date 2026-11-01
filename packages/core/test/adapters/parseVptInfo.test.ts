import { describe, expect, test } from 'vitest'
import { parseVptInfo } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseVptInfo', () => {
  test.each([
    [
      'vpt-info/player-armv7-release.json',
      { id: 'com.example.player', title: 'Sample Player', version: '1.4.2', buildNumber: 142 }
    ],
    [
      'vpt-info/player-aarch64-debug.json',
      { id: 'com.example.player', title: 'Sample Player', version: '1.4.2', buildNumber: 142 }
    ],
    [
      'vpt-info/hellovega-armv7-release.json',
      { id: 'com.example.hellovega', version: '0.1.0', buildNumber: 0 }
    ]
  ])('%s', (file, expected) => {
    const info = parseVptInfo(fixture(`0.24/${file}`))
    expect(info).toMatchObject({
      ...expected,
      osVersions: ['1.2'],
      contractPackageVersion: '1.0.323.0'
    })
    expect(info.unpackedSize).toBeGreaterThan(0)
  })

  test('keeps the document as printed', () => {
    const out = fixture('0.24/vpt-info/player-armv7-release.json')
    expect(parseVptInfo(out).raw).toEqual(JSON.parse(out))
  })

  test.each([
    '',
    'Error: archive is not a vpkg compression archive',
    '{"id":"com.example.player"}'
  ])('rejects %j', (out) => {
    expect(() => parseVptInfo(out)).toThrow(expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' }))
  })
})
