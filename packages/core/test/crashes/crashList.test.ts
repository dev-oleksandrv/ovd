import { describe, expect, test, vi } from 'vitest'
import {
  createCrashLedger,
  createCrashReader,
  MAX_CRASHES,
  parseCrashId
} from '../../src/crashes/crashList.js'
import type { InstalledPackage } from '../../src/crashes/scope.js'
import { acrScript, deviceScript } from '../../src/deviceApps/launchScripts.js'
import type { Devices } from '../../src/devices/devices.js'
import type { Device } from '../../src/devices/types.js'
import { createSdkLocator } from '../../src/index.js'
import { FakeRunner } from '../support/fakeRunner.js'
import { fixture } from '../support/fixtures.js'

const VVD: Device = {
  id: 'VirtualDevice',
  vdaSerial: 'emulator-5554',
  name: 'Vega Virtual Device',
  kind: 'vvd',
  connection: 'local',
  status: 'online',
  isTarget: true,
  saved: false
}
const SHELL = 'vega exec vda -s emulator-5554 shell'
const LS = `${SHELL} loggingctl vault --ls SYSTEM_TOMBSTONE/acr`
const acr = (index: number) => `${SHELL} ${deviceScript(acrScript(index))}`
const out = (path: string) => ({ stdout: fixture(`0.24/${path}`), exitCode: 0 })
const AFTER = out('loggingctl-vault-ls/virtual-device-tombstones-after.json')
const CRASHED = out('loggingctl-vault-acr/virtual-device-crashed.txt')
const INSTALLED: InstalledPackage[] = [
  { packageId: 'com.example.player', source: 'sideloaded' },
  { packageId: 'com.amazon.diode', source: 'system' }
]

function devicesOf(device: Device = VVD): Devices {
  const no = () => Promise.reject(new Error('not used'))
  return {
    list: no,
    get: no,
    rename: no,
    setTarget: no,
    invalidate: () => undefined,
    currentTarget: async () => ({ device, source: 'flag' })
  }
}

function setup(
  script: ConstructorParameters<typeof FakeRunner>[0],
  installed: InstalledPackage[] = INSTALLED,
  clock?: () => number
) {
  const runner = new FakeRunner(script)
  const sdk = createSdkLocator(async () => ({
    vegaPath: '/sdk/vega',
    cli: 'manager',
    sdkVersion: '0.24.12112',
    cliVersion: '1.4.5'
  }))
  const ledger = createCrashLedger()
  const read = vi.fn(async () => installed)
  const reader = createCrashReader({
    runner,
    sdk,
    devices: devicesOf(),
    installed: read,
    ledger,
    ...(clock ? { now: clock } : {})
  })
  return { reader, runner, ledger, read, calls: () => runner.calls.map((c) => c.display) }
}

const names = (...indexes: number[]) =>
  JSON.stringify({
    artifacts: indexes.map(
      (i) => `${i}#crash_${1794000000 + i}_1_1_${i + 1000}_6_com_example_player.acr`
    ),
    status: 0
  })

describe('list', () => {
  test('returns the in-scope reports only, newest first, with kind, summary, version and build', async () => {
    const { reader, calls } = setup({ [LS]: AFTER, [acr(37)]: CRASHED, [acr(35)]: CRASHED })

    const { device, crashes } = await reader.list()

    expect(device).toBe('VirtualDevice')
    expect(crashes).toEqual([
      {
        id: 37,
        package: 'com.example.player',
        kind: 'js',
        signal: 6,
        signalName: 'SIGABRT',
        pid: 3200,
        time: '2026-11-08T01:51:44.000Z',
        version: '0.1.0',
        build: '1',
        summary: 'Error: player: deliberate crash right after launch',
        // The first read of the device is the baseline: nothing is NEW.
        new: false
      },
      expect.objectContaining({ id: 35, pid: 2925, new: false })
    ])
    // The system package's report (34, com_amazon_diode) is never read.
    expect(calls()).not.toContain(acr(34))
  })

  test('every script sent to the device carries only the integer index', async () => {
    const { reader, runner } = setup({ [LS]: AFTER, [acr(37)]: CRASHED, [acr(35)]: CRASHED })
    await reader.list()

    const scripts = runner.calls
      .map((c) => / shell echo ([A-Za-z0-9+/=]+) \| base64 -d \| sh$/.exec(c.display)?.[1])
      .filter((b): b is string => b !== undefined)
      .map((b) => Buffer.from(b, 'base64').toString())
    expect(scripts).toHaveLength(2)
    for (const script of scripts) {
      expect(script).toMatch(/^loggingctl vault --cat SYSTEM_TOMBSTONE \d+ \| sed /)
    }
  })

  test('a header read once per device and index; entries that leave the listing are evicted', async () => {
    const { reader, runner } = setup({
      [LS]: [AFTER, out('loggingctl-vault-ls/virtual-device-tombstones-before.json'), AFTER],
      [acr(37)]: CRASHED,
      [acr(35)]: CRASHED
    })
    await reader.list()
    await reader.list()
    expect(runner.count(acr(35))).toBe(1)
    expect(runner.count(acr(37))).toBe(1)

    // `before` has 35 and 34 only: 37 left the listing, so its cache entry is gone.
    // (The second list above read `before`; this one reads `after` again.)
    await reader.list()
    expect(runner.count(acr(35))).toBe(1)
    expect(runner.count(acr(37))).toBe(2)
  })

  test('a report that appeared after the first read is NEW, unless a launch reported it', async () => {
    const before = out('loggingctl-vault-ls/virtual-device-tombstones-before.json')
    const { reader, ledger } = setup({
      [LS]: [before, AFTER],
      [acr(37)]: CRASHED,
      [acr(35)]: CRASHED
    })
    expect((await reader.list()).crashes.map((c) => [c.id, c.new])).toEqual([[35, false]])

    ledger.add('VirtualDevice', 37)
    expect((await reader.list()).crashes.map((c) => [c.id, c.new])).toEqual([
      [37, false],
      [35, false]
    ])
  })

  test('a new report is NEW when no launch reported it', async () => {
    const before = out('loggingctl-vault-ls/virtual-device-tombstones-before.json')
    const { reader } = setup({ [LS]: [before, AFTER], [acr(37)]: CRASHED, [acr(35)]: CRASHED })
    await reader.list()
    expect((await reader.list()).crashes.map((c) => [c.id, c.new])).toEqual([
      [37, true],
      [35, false]
    ])
  })

  test.each([
    ['status -7', out('loggingctl-vault-acr/insufficient-permissions.json').stdout],
    ['status -8', 'No entry found for tag SYSTEM_TOMBSTONE\n'],
    ['an empty output', '']
  ])(
    'a report whose header can’t be read (%s) is still listed, as native, with no summary',
    async (_n, stdout) => {
      const { reader } = setup({
        [LS]: AFTER,
        [acr(37)]: { stdout, exitCode: 0 },
        [acr(35)]: CRASHED
      })
      const { crashes } = await reader.list()
      const [first] = crashes
      expect(first).toEqual({
        id: 37,
        package: 'com.example.player',
        kind: 'native',
        signal: 6,
        signalName: 'SIGABRT',
        pid: 3200,
        time: '2026-11-08T01:51:44.000Z',
        new: false
      })
    }
  )

  test('keeps the newest 200 reports and reads only their headers', async () => {
    const indexes = Array.from({ length: MAX_CRASHES + 50 }, (_, i) => i)
    const script: ConstructorParameters<typeof FakeRunner>[0] = {
      [LS]: { stdout: names(...indexes) }
    }
    for (const i of indexes) script[acr(i)] = CRASHED
    const { reader, runner } = setup(script)

    const { crashes } = await reader.list()

    expect(crashes).toHaveLength(MAX_CRASHES)
    expect(crashes[0]?.id).toBe(MAX_CRASHES + 49)
    expect(crashes.at(-1)?.id).toBe(50)
    expect(runner.calls.filter((c) => c.display.includes('base64 -d'))).toHaveLength(MAX_CRASHES)
  })

  test('find resolves an id beyond the newest 200 against the full listing', async () => {
    const indexes = Array.from({ length: MAX_CRASHES + 1 }, (_, i) => i)
    const script: ConstructorParameters<typeof FakeRunner>[0] = {
      [LS]: { stdout: names(...indexes) }
    }
    for (const i of indexes) script[acr(i)] = CRASHED
    const { reader } = setup(script)

    // 0 is the oldest of 201: the list leaves it out, an explicit id still finds it.
    expect((await reader.list()).crashes.map((c) => c.id)).not.toContain(0)
    const found = await reader.find(0)
    expect(found.crash.id).toBe(0)
    expect(found.crash.package).toBe('com.example.player')
  })

  test('a collision installed after the first snapshot makes the next new report ambiguous', async () => {
    const before = out('loggingctl-vault-ls/virtual-device-tombstones-before.json')
    let installed: InstalledPackage[] = INSTALLED
    let at = 0
    const runner = new FakeRunner({ [LS]: [before, AFTER], [acr(37)]: CRASHED, [acr(35)]: CRASHED })
    const sdk = createSdkLocator(async () => ({
      vegaPath: '/sdk/vega',
      cli: 'manager',
      sdkVersion: '0.24.12112',
      cliVersion: '1.4.5'
    }))
    const read = vi.fn(async () => installed)
    const reader = createCrashReader({
      runner,
      sdk,
      devices: devicesOf(),
      installed: read,
      ledger: createCrashLedger(),
      now: () => at
    })
    await reader.list()
    expect(read).toHaveBeenCalledTimes(1)

    installed = [...INSTALLED, { packageId: 'com.example_player', source: 'sideloaded' }]
    at = 10_000
    // Report 37 wasn't seen before: the scope is revalidated before it is authorized.
    expect((await reader.list()).crashes).toEqual([])
    expect(read).toHaveBeenCalledTimes(2)
    expect(runner.count(acr(37))).toBe(0)
  })

  test('a colliding package installed within 10 s of the last snapshot makes the new report ambiguous on the very next scan', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      const before = out('loggingctl-vault-ls/virtual-device-tombstones-before.json')
      let installed: InstalledPackage[] = INSTALLED
      const runner = new FakeRunner({
        [LS]: [before, AFTER],
        [acr(37)]: CRASHED,
        [acr(35)]: CRASHED
      })
      const sdk = createSdkLocator(async () => ({
        vegaPath: '/sdk/vega',
        cli: 'manager',
        sdkVersion: '0.24.12112',
        cliVersion: '1.4.5'
      }))
      const read = vi.fn(async () => installed)
      const reader = createCrashReader({
        runner,
        sdk,
        devices: devicesOf(),
        installed: read,
        ledger: createCrashLedger()
      })
      await reader.list()
      expect(read).toHaveBeenCalledTimes(1)

      installed = [...INSTALLED, { packageId: 'com.example_player', source: 'sideloaded' }]
      vi.setSystemTime(2_000)
      expect((await reader.list()).crashes).toEqual([])
      expect(read).toHaveBeenCalledTimes(2)
      expect(runner.count(acr(37))).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test('a failed package refresh leaves the new report unlisted and unread, and the next poll retries', async () => {
    const before = out('loggingctl-vault-ls/virtual-device-tombstones-before.json')
    const runner = new FakeRunner({
      [LS]: [before, AFTER, AFTER],
      [acr(37)]: CRASHED,
      [acr(35)]: CRASHED
    })
    const sdk = createSdkLocator(async () => ({
      vegaPath: '/sdk/vega',
      cli: 'manager',
      sdkVersion: '0.24.12112',
      cliVersion: '1.4.5'
    }))
    let fail = false
    const read = vi.fn(async () => {
      if (fail) throw new Error('vda busy')
      return INSTALLED
    })
    const reader = createCrashReader({
      runner,
      sdk,
      devices: devicesOf(),
      installed: read,
      ledger: createCrashLedger(),
      now: () => 0
    })
    expect((await reader.list()).crashes.map((c) => c.id)).not.toContain(37)

    fail = true
    const second = (await reader.list().catch(() => ({ crashes: [] }))).crashes.map((c) => c.id)
    expect(second).not.toContain(37)
    expect(runner.count(acr(37))).toBe(0)

    fail = false
    expect((await reader.list()).crashes.map((c) => c.id)).toContain(37)
    expect(runner.count(acr(37))).toBe(1)
  })

  test('invalidate drops the installed snapshot, so an own install or uninstall is seen at once', async () => {
    const { reader, read } = setup({ [LS]: AFTER, [acr(37)]: CRASHED, [acr(35)]: CRASHED })
    await reader.list()
    await reader.list()
    expect(read).toHaveBeenCalledTimes(1)

    reader.invalidate('VirtualDevice')
    await reader.list()
    expect(read).toHaveBeenCalledTimes(2)
  })

  test.each([
    [
      'a refused listing (-7) is CRASH_ACCESS_DENIED',
      out('loggingctl-vault-acr/insufficient-permissions.json'),
      'CRASH_ACCESS_DENIED'
    ],
    ['an unreadable listing is UNEXPECTED_OUTPUT', { stdout: 'nope\n' }, 'UNEXPECTED_OUTPUT'],
    [
      'a failed command is COMMAND_FAILED',
      { stdout: '', stderr: 'boom', exitCode: 1 },
      'COMMAND_FAILED'
    ],
    [
      'a device that left is TARGET_OFFLINE',
      { stdout: '', stderr: "error: device 'emulator-5554' not found", exitCode: 1 },
      'TARGET_OFFLINE'
    ]
  ])('%s, not an empty list', async (_name, answer, code) => {
    const { reader } = setup({ [LS]: answer })
    await expect(reader.list()).rejects.toMatchObject({ code })
  })

  test('nothing in scope is an empty list, and the installed packages are not read', async () => {
    const { reader, read } = setup({ [LS]: { stdout: '{"artifacts": [], "status": 0}' } })
    expect(await reader.list()).toEqual({ device: 'VirtualDevice', crashes: [] })
    expect(read).not.toHaveBeenCalled()
  })

  test('an app named like another (com.example_player) makes the report ambiguous: not listed or read', async () => {
    const { reader, calls } = setup({ [LS]: AFTER }, [
      { packageId: 'com.example.player', source: 'sideloaded' },
      { packageId: 'com.example_player', source: 'store' }
    ])
    expect((await reader.list()).crashes).toEqual([])
    expect(calls().filter((c) => c.includes('base64'))).toEqual([])
  })
})

describe('find', () => {
  test('an in-scope report, with its stack', async () => {
    const { reader } = setup({ [LS]: AFTER, [acr(37)]: CRASHED })
    const found = await reader.find('37')
    expect(found.crash).toMatchObject({ id: 37, package: 'com.example.player' })
    expect(found.reason).toBe('SIGABRT')
    expect(found.stack).toEqual([expect.stringMatching(/^at anonymous \(/)])
    expect(found.device.id).toBe('VirtualDevice')
  })

  test.each([['34'], ['999'], [34]])(
    'id %s (out of scope or unknown) is CRASH_NOT_FOUND, and nothing is read',
    async (id) => {
      const { reader, calls } = setup({ [LS]: AFTER })
      await expect(reader.find(id)).rejects.toMatchObject({ code: 'CRASH_NOT_FOUND' })
      expect(calls().filter((c) => c.includes('base64'))).toEqual([])
    }
  )

  test('an invalid id is INVALID_CRASH_ID before any SDK call', async () => {
    const { reader, runner } = setup({})
    await expect(reader.find('37; reboot')).rejects.toMatchObject({ code: 'INVALID_CRASH_ID' })
    expect(runner.calls).toEqual([])
  })
})

describe('parseCrashId', () => {
  test.each([
    ['0', 0],
    ['37', 37],
    [37, 37],
    ['123456789', 123456789]
  ])('%s is %i', (value, id) => {
    expect(parseCrashId(value)).toBe(id)
  })

  test.each([
    [''],
    ['-1'],
    ['1.5'],
    ['1e3'],
    ['037'],
    [' 37'],
    ['37\n'],
    ['0x25'],
    ['37; reboot'],
    ['$(reboot)'],
    ['1234567890'],
    [-1],
    [1.5],
    [Number.NaN],
    [Number.MAX_SAFE_INTEGER]
  ])('%j is INVALID_CRASH_ID', (value) => {
    expect(() => parseCrashId(value)).toThrow(expect.objectContaining({ code: 'INVALID_CRASH_ID' }))
  })
})

describe('createCrashLedger', () => {
  test('remembers device + index, and forgets the oldest past its size', () => {
    const ledger = createCrashLedger(2)
    ledger.add('a', 1)
    ledger.add('a', 2)
    ledger.add('b', 1)
    expect(ledger.has('a', 1)).toBe(false)
    expect(ledger.has('a', 2)).toBe(true)
    expect(ledger.has('b', 1)).toBe(true)
  })
})
