import { describe, expect, test } from 'vitest'
import { parseTombstones, parseTombstonesStrict, signalName } from '../../src/index.js'
import { MAX_LISTING_BYTES, MAX_LISTING_NAMES } from '../../src/adapters/parseTombstones.js'
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

const listing = (...artifacts: string[]) => JSON.stringify({ artifacts, status: 0 })
const GOOD = '35#crash_1794102692_30041_5000_2925_6_com_example_player.acr'

describe('the name pattern', () => {
  test.each([
    ['a recorded name', GOOD, true],
    ['index 0', '0#crash_1794102692_30041_5000_2925_6_com_example_player.acr', true],
    [
      'a hyphen in the package',
      '35#crash_1794102692_30041_5000_2925_6_com_example_my-app.acr',
      true
    ],
    [
      'a leading zero in the index',
      '035#crash_1794102692_30041_5000_2925_6_com_example_player.acr',
      false
    ],
    ['a negative index', '-1#crash_1794102692_30041_5000_2925_6_com_example_player.acr', false],
    [
      'an oversized index',
      '1234567890#crash_1794102692_30041_5000_2925_6_com_example_player.acr',
      false
    ],
    ['a non-numeric index', 'x#crash_1794102692_30041_5000_2925_6_com_example_player.acr', false],
    [
      'a traversal-like package',
      '35#crash_1794102692_30041_5000_2925_6_../../etc/passwd.acr',
      false
    ],
    ['a slash in the package', '35#crash_1794102692_30041_5000_2925_6_com/example.acr', false],
    [
      'a traversal prefix',
      '../35#crash_1794102692_30041_5000_2925_6_com_example_player.acr',
      false
    ],
    [
      'a shell metacharacter',
      '35#crash_1794102692_30041_5000_2925_6_com_example;reboot.acr',
      false
    ],
    ['a command substitution', '35#crash_1794102692_30041_5000_2925_6_$(reboot).acr', false],
    ['a newline', `${GOOD}\n`, false],
    ['a space', '35#crash_1794102692_30041_5000_2925_6_com example.acr', false],
    ['another extension', '35#crash_1794102692_30041_5000_2925_6_com_example_player.txt', false],
    ['a missing signal', '35#crash_1794102692_30041_5000_2925_com_example_player.acr', false],
    [
      'an oversized epoch',
      '35#crash_17941026921794_30041_5000_2925_6_com_example_player.acr',
      false
    ],
    [
      'an oversized signal',
      '35#crash_1794102692_30041_5000_2925_1234_com_example_player.acr',
      false
    ],
    ['an oversized package', `35#crash_1794102692_30041_5000_2925_6_${'a'.repeat(201)}.acr`, false],
    ['an oversized name', `35#crash_1794102692_30041_5000_2925_6_${'a'.repeat(5000)}.acr`, false]
  ])('%s', (_name, name, ok) => {
    expect(parseTombstones(listing(name))).toHaveLength(ok ? 1 : 0)
    expect(parseTombstonesStrict(listing(name))).toHaveLength(ok ? 1 : 0)
  })

  test('a listing is read for at most 5000 names', () => {
    const names = Array.from(
      { length: MAX_LISTING_NAMES + 10 },
      (_, i) => `${i}#crash_1794102692_30041_5000_2925_6_com_example_player.acr`
    )
    expect(parseTombstonesStrict(listing(...names))).toHaveLength(MAX_LISTING_NAMES)
  })
})

describe('a long listing', () => {
  // Oldest first, so the newest names come last in the unsorted listing.
  const many = (count: number) =>
    Array.from(
      { length: count },
      (_, i) => `${i}#crash_${1794000000 + i}_30041_5000_${i + 1}_6_com_example_player.acr`
    )

  test('strict: every name is validated, sorted newest first, and only then cut to 5000', () => {
    const found = parseTombstonesStrict(listing(...many(MAX_LISTING_NAMES + 10)))
    expect(found).toHaveLength(MAX_LISTING_NAMES)
    expect(found[0]?.index).toBe(String(MAX_LISTING_NAMES + 9))
    expect(found.at(-1)?.index).toBe('10')
  })

  test('launch enrichment sees the names past 5000 too, in the printed order', () => {
    const found = parseTombstones(listing(...many(MAX_LISTING_NAMES + 10)))
    expect(found).toHaveLength(MAX_LISTING_NAMES + 10)
    expect(found[0]?.index).toBe('0')
    expect(found.at(-1)?.index).toBe(String(MAX_LISTING_NAMES + 9))
  })

  test('the input is bounded by bytes: a listing past the cap is unreadable', () => {
    const huge = JSON.stringify({ artifacts: ['x'.repeat(MAX_LISTING_BYTES)], status: 0 })
    expect(parseTombstones(huge)).toEqual([])
    expect(() => parseTombstonesStrict(huge)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})

describe('parseTombstonesStrict', () => {
  test('reads the recorded listings as parseTombstones does, newest first', () => {
    for (const file of ['stick-tombstones', 'virtual-device-tombstones-after']) {
      const newestFirst = [...parseTombstones(ls(file))].sort((a, b) => b.epochS - a.epochS)
      expect(parseTombstonesStrict(ls(file))).toEqual(newestFirst)
    }
  })

  test('an empty vault is an empty list', () => {
    expect(parseTombstonesStrict(listing())).toEqual([])
  })

  test('a refused listing (-7) is CRASH_ACCESS_DENIED, not an empty list', () => {
    const refused = fixture('0.24/loggingctl-vault-acr/insufficient-permissions.json')
    expect(parseTombstones(refused)).toEqual([])
    expect(() => parseTombstonesStrict(refused)).toThrow(
      expect.objectContaining({ code: 'CRASH_ACCESS_DENIED' })
    )
    expect(() => parseTombstonesStrict('{"status":-7,"error":"x"}')).toThrow(
      expect.objectContaining({ code: 'CRASH_ACCESS_DENIED' })
    )
  })

  test.each([
    ['not JSON', 'No entry found for tag SYSTEM_TOMBSTONE\n'],
    ['empty output', ''],
    ['another status', '{"artifacts": [], "status": -8}'],
    ['the wrong shape', '{"artifacts": "x", "status": 0}']
  ])('%s is UNEXPECTED_OUTPUT, not an empty list', (_name, out) => {
    expect(parseTombstones(out)).toEqual([])
    expect(() => parseTombstonesStrict(out)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})

describe('the stick listings with an lrk entry', () => {
  const LRK = '2094'

  test.each([
    ['stick-before', []],
    ['stick-after', ['2100']]
  ])('%s: both parsers skip the lrk entry', (file, indexes) => {
    expect(ls(file)).toContain(`${LRK}#crash_`)
    expect(ls(file)).toContain('_lrk_')
    expect(parseTombstones(ls(file)).map((t) => t.index)).toEqual(indexes)
    expect(parseTombstonesStrict(ls(file)).map((t) => t.index)).toEqual(indexes)
  })

  test('stick-after lists exactly the player report 2100', () => {
    expect(parseTombstonesStrict(ls('stick-after'))).toEqual([
      {
        index: '2100',
        epochS: 1794603616,
        pid: 5410,
        signal: 6,
        packageUnderscored: 'com_example_player'
      }
    ])
  })
})
