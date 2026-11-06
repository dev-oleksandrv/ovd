import { describe, expect, test } from 'vitest'
import { parseVpmComponent, parseVpmPackages, vpmNotFound } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseVpmPackages', () => {
  test('one package', () => {
    expect(parseVpmPackages(fixture('0.24/vpm-info-package/player.txt'))).toEqual([
      {
        id: 'com.example.player',
        title: 'Basic UI React Native Application for project player',
        version: '0.1.0',
        buildNumber: 1,
        installedAt: '2026-11-05T23:01:46.000Z',
        updatedAt: '2026-11-05T23:01:46.000Z',
        installerId: 'com.amazon.package-manager.cli',
        componentIds: ['com.example.player.main']
      }
    ])
  })

  test('every package on the Virtual Device, back to back', () => {
    const all = parseVpmPackages(fixture('0.24/vpm-info-package-all/virtual-device-player.txt'))
    expect(all).toHaveLength(40)
    expect(all.filter((p) => p.installerId === 'com.amazon.package-manager.cli')).toEqual([
      expect.objectContaining({
        id: 'com.example.player',
        componentIds: ['com.example.player.main']
      })
    ])
    const launcher = all.find((p) => p.id === 'com.amazon.keplerlauncherapp')
    expect(launcher).toMatchObject({
      installerId: 'com.amazon.package-manager.service',
      componentIds: ['com.amazon.keplerlauncherapp.main']
    })
    // Library packages have no components.
    expect(all.some((p) => p.componentIds.length === 0)).toBe(true)
  })

  test('without the player', () => {
    const all = parseVpmPackages(fixture('0.24/vpm-info-package-all/virtual-device.txt'))
    expect(all).toHaveLength(39)
    expect(all.find((p) => p.id === 'com.example.player')).toBeUndefined()
  })

  test('every package on a stick: system ones (one with an empty version) and one from the Appstore', () => {
    const all = parseVpmPackages(fixture('0.24/vpm-info-package-all/stick.txt'))
    expect(all).toHaveLength(107)
    expect(all.filter((p) => p.installerId !== 'com.amazon.package-manager.service')).toEqual([
      expect.objectContaining({
        id: 'com.example.player',
        title: 'Example Player',
        installerId: 'com.amazon.venezia|MC-S-0000000000001',
        componentIds: ['com.example.player.main', 'com.example.player.service']
      })
    ])
  })

  test.each([
    ['empty output', ''],
    ['output without any package', 'error: device offline']
  ])('%s: no packages', (_name, out) => {
    expect(parseVpmPackages(out)).toEqual([])
  })

  test('a block with fields missing', () => {
    expect(() =>
      parseVpmPackages('id:           com.example.player\nversion:      0.1.0\n')
    ).toThrow(expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' }))
  })
})

describe('parseVpmComponent', () => {
  test('the player’s main component', () => {
    expect(parseVpmComponent(fixture('0.24/vpm-info-component/player-main.txt'))).toEqual({
      id: 'com.example.player.main',
      type: 'interactive',
      launchType: 'singleton'
    })
  })

  test('unexpected output', () => {
    expect(() => parseVpmComponent('nothing here')).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})

describe('vpmNotFound', () => {
  test.each([
    ['vpm-info-package/missing.txt', 'com.example.player'],
    ['vpm-info-component/missing.txt', 'com.example.player.main']
  ])('%s', (file, id) => {
    expect(vpmNotFound(fixture(`0.24/${file}`))).toBe(id)
  })

  test('a found package', () => {
    expect(vpmNotFound(fixture('0.24/vpm-info-package/player.txt'))).toBeUndefined()
  })
})
