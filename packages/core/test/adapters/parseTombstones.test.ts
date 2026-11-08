import { describe, expect, test } from 'vitest'
import { parseTombstones, signalName } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

const ls = (name: string) => fixture(`0.24/loggingctl-vault-ls/${name}.json`)

describe('parseTombstones', () => {
  test('reads index, time, pid, signal and package from each name, unsorted as printed', () => {
    expect(parseTombstones(ls('virtual-device-tombstones-after'))).toEqual([
      {
        index: '35',
        epochS: 1794102692,
        pid: 2925,
        signal: 6,
        packageUnderscored: 'com_example_player'
      },
      {
        index: '34',
        epochS: 1794087390,
        pid: 2642,
        signal: 6,
        packageUnderscored: 'com_amazon_diode'
      },
      {
        index: '37',
        epochS: 1794102704,
        pid: 3200,
        signal: 6,
        packageUnderscored: 'com_example_player'
      }
    ])
  })

  test.each([
    ['the stick', 'stick-tombstones', ['2085', '2086', '2084']],
    ['the Virtual Device before the launch', 'virtual-device-tombstones-before', ['35', '34']]
  ])('%s', (_name, file, indexes) => {
    expect(parseTombstones(ls(file)).map((t) => t.index)).toEqual(indexes)
  })

  test.each([
    [
      'a refused read (status -7)',
      fixture('0.24/loggingctl-vault-acr/insufficient-permissions.json')
    ],
    ['garbage', 'vda: device offline'],
    ['empty output', ''],
    ['another shape', '{"artifacts": "x", "status": 0}']
  ])('%s: none', (_name, out) => {
    expect(parseTombstones(out)).toEqual([])
  })

  test('a name that isn’t a crash report is skipped', () => {
    const out = JSON.stringify({
      artifacts: ['12#notes.txt', '37#crash_1794102704_30041_5000_3200_6_com_example_player.acr'],
      status: 0
    })
    expect(parseTombstones(out).map((t) => t.index)).toEqual(['37'])
  })
})

describe('signalName', () => {
  test.each([
    [6, 'SIGABRT'],
    [11, 'SIGSEGV'],
    [9, 'SIGKILL'],
    [99, undefined]
  ])('%i', (n, name) => {
    expect(signalName(n)).toBe(name)
  })
})
