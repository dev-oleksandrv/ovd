import { describe, expect, test, vi } from 'vitest'
import type { Device } from '../../src/devices/types.js'
import {
  createScope,
  SCOPE_MIN_REFRESH_MS,
  SCOPE_TTL_MS,
  packageInScope,
  type InstalledPackage
} from '../../src/crashes/scope.js'

const side = (packageId: string): InstalledPackage => ({ packageId, source: 'sideloaded' })
const store = (packageId: string): InstalledPackage => ({ packageId, source: 'store' })
const system = (packageId: string): InstalledPackage => ({ packageId, source: 'system' })

describe('packageInScope', () => {
  test.each<[string, InstalledPackage[], string, string | undefined]>([
    ['a side-loaded app', [side('com.example.player')], 'com_example_player', 'com.example.player'],
    [
      'a system package is dropped (com_amazon_diode)',
      [side('com.example.player'), system('com.amazon.diode')],
      'com_amazon_diode',
      undefined
    ],
    ['a store app is dropped', [store('com.example.store')], 'com_example_store', undefined],
    [
      'an app that is not installed is dropped',
      [side('com.example.player')],
      'com_example_gone',
      undefined
    ],
    [
      'two packages with the same encoding are ambiguous, never decoded (both side-loaded)',
      [side('com.example.player'), side('com.example_player')],
      'com_example_player',
      undefined
    ],
    [
      'a side-loaded app colliding with a system package is ambiguous',
      [side('com.example.player'), system('com.example_player')],
      'com_example_player',
      undefined
    ],
    [
      'a side-loaded app colliding with a store app is ambiguous',
      [store('com.example.player'), side('com.example_player')],
      'com_example_player',
      undefined
    ],
    [
      'a system package named like a side-loaded one is out of scope on its own',
      [system('com.example_player')],
      'com_example_player',
      undefined
    ],
    [
      'an underscore in the installed ID matches its own encoding only',
      [side('com.example_player')],
      'com_example_player',
      'com.example_player'
    ],
    [
      'an ID that is not an app ID is dropped',
      [side('com.example.pl ayer')],
      'com_example_pl ayer',
      undefined
    ]
  ])('%s', (_name, installed, name, expected) => {
    expect(packageInScope(installed, name)).toBe(expected)
  })
})

describe('createScope', () => {
  const device: Device = {
    id: 'VirtualDevice',
    name: 'Vega Virtual Device',
    kind: 'vvd',
    connection: 'local',
    status: 'online',
    isTarget: true,
    saved: false
  }

  function setup(installed: InstalledPackage[]) {
    let clock = 0
    const read = vi.fn(async () => installed)
    const scope = createScope({ read, now: () => clock })
    return { scope, read, advance: (ms: number) => (clock += ms) }
  }

  test('reads the installed packages once and answers from them', async () => {
    const { scope, read } = setup([side('com.example.player'), system('com.amazon.diode')])
    const names = new Set(['com_example_player', 'com_amazon_diode'])

    expect(await scope.resolve(device, names)).toEqual(
      new Map([['com_example_player', 'com.example.player']])
    )
    await scope.resolve(device, names)
    expect(read).toHaveBeenCalledTimes(1)
  })

  test('reads nothing for an empty listing', async () => {
    const { scope, read } = setup([])
    expect(await scope.resolve(device, new Set())).toEqual(new Map())
    expect(read).not.toHaveBeenCalled()
  })

  test('a name nobody installed re-reads early, but not more often than every 10 s', async () => {
    const { scope, read, advance } = setup([side('com.example.player')])
    const names = new Set(['com_example_player', 'com_example_gone'])
    await scope.resolve(device, names)

    advance(SCOPE_MIN_REFRESH_MS - 1)
    await scope.resolve(device, names)
    expect(read).toHaveBeenCalledTimes(1)

    advance(1)
    await scope.resolve(device, names)
    expect(read).toHaveBeenCalledTimes(2)
  })

  test('known names re-read only when the snapshot is a minute old', async () => {
    const { scope, read, advance } = setup([side('com.example.player')])
    const names = new Set(['com_example_player'])
    await scope.resolve(device, names)

    advance(SCOPE_TTL_MS - 1)
    await scope.resolve(device, names)
    expect(read).toHaveBeenCalledTimes(1)

    advance(1)
    await scope.resolve(device, names)
    expect(read).toHaveBeenCalledTimes(2)
  })
})
