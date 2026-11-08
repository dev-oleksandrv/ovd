import { describe, expect, test } from 'vitest'
import { parseVlcmCrashHistory } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

const history = (name: string) => fixture(`0.24/vlcm-crash-history/${name}.txt`)

describe('parseVlcmCrashHistory', () => {
  test.each([
    ['a stick with no crash since boot', 'stick-empty', []],
    ['one crash', 'stick-one', [19871]],
    ['two crashes, newest first', 'stick-two', [20609, 19871]],
    ['a system package’s crash too', 'virtual-device-before', [2529, 2925]],
    ['the new crash first', 'virtual-device-after', [3200, 2529, 2925]]
  ])('%s', (_name, file, pids) => {
    expect(parseVlcmCrashHistory(history(file)).map((e) => e.pid)).toEqual(pids)
  })

  test('reads pid, package, uptime and the epoch ms of each entry', () => {
    expect(parseVlcmCrashHistory(history('virtual-device-after'))).toEqual([
      {
        pid: 3200,
        packageId: 'com.example.player',
        timestamp: '35.949805640s',
        killTimeMs: 1794102704657
      },
      {
        pid: 2529,
        packageId: 'com.amazon.diode',
        timestamp: '25.909387094s',
        killTimeMs: 1794102694617
      },
      {
        pid: 2925,
        packageId: 'com.example.player',
        timestamp: '23.334304884s',
        killTimeMs: 1794102692041
      }
    ])
  })

  // The stick-one entry with its count, cut to a header that promises two.
  const oneOfTwo = history('stick-one').replace('Size: 1', 'Size: 2')
  const noKillTime = history('stick-one').replace(/^.*LCM_KILLTIME.*\n/m, '')

  test.each([
    ['empty output', ''],
    ['an error', 'vda: device offline'],
    ['a size that doesn’t match the entries', oneOfTwo],
    ['an entry without its epoch ms', noKillTime]
  ])('%s', (_name, out) => {
    expect(() => parseVlcmCrashHistory(out)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})
