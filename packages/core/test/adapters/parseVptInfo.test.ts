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

  // SDK 2.0's template targets OS 2.0 and still lists 1.2.
  test('2.0/vpt-info/hellovega-x86_64-debug.json', () => {
    expect(parseVptInfo(fixture('2.0/vpt-info/hellovega-x86_64-debug.json'))).toMatchObject({
      id: 'com.example.hellovega',
      title: 'Basic UI React Native Application for project hellovega',
      version: '0.1.0',
      buildNumber: 1,
      unpackedSize: 1127517,
      osVersions: ['1.2', '2.0'],
      contractPackageVersion: '1.0.4482.0'
    })
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
