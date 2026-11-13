import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ActivityEntry, ActivityLog } from '../../src/activity/activityLog.js'
import { createCrashLedger, createCrashReader } from '../../src/crashes/crashList.js'
import { CRASH_POLL_MS, createCrashWatch } from '../../src/crashes/crashWatch.js'
import type { Crash } from '../../src/crashes/types.js'
import { acrScript, deviceScript } from '../../src/deviceApps/launchScripts.js'
import type { Devices } from '../../src/devices/devices.js'
import type { Device } from '../../src/devices/types.js'
import { createSdkLocator, OvdError } from '../../src/index.js'
import { FakeRunner } from '../support/fakeRunner.js'
import { fixture } from '../support/fixtures.js'

const SHELL = 'vega exec vda -s emulator-5554 shell'
const LS = `${SHELL} loggingctl vault --ls SYSTEM_TOMBSTONE/acr`
const acr = (index: number) => `${SHELL} ${deviceScript(acrScript(index))}`
const out = (path: string) => ({ stdout: fixture(`0.24/${path}`), exitCode: 0 })
const BEFORE = out('loggingctl-vault-ls/virtual-device-tombstones-before.json')
const AFTER = out('loggingctl-vault-ls/virtual-device-tombstones-after.json')
const EMPTY = { stdout: '{"artifacts": [], "status": 0}' }
const CRASHED = out('loggingctl-vault-acr/virtual-device-crashed.txt')

const device: Device = {
  id: 'VirtualDevice',
  vdaSerial: 'emulator-5554',
  name: 'Vega Virtual Device',
  kind: 'vvd',
  connection: 'local',
  status: 'online',
  isTarget: true,
  saved: false
}

function setup(
  script: ConstructorParameters<typeof FakeRunner>[0],
  opts: { current?: () => Device | null; activity?: ActivityLog } = {}
) {
  const runner = new FakeRunner({ [acr(37)]: CRASHED, [acr(35)]: CRASHED, ...script })
  const sdk = createSdkLocator(async () => ({
    vegaPath: '/sdk/vega',
    cli: 'manager',
    sdkVersion: '0.24.12112',
    cliVersion: '1.4.5'
  }))
  const state = { device: { ...device } as Device | null }
  const no = () => Promise.reject(new Error('not used'))
  const devices: Devices = {
    list: no,
    get: no,
    rename: no,
    setTarget: no,
    invalidate: () => undefined,
    currentTarget: async () => {
      const current = opts.current ? opts.current() : state.device
      return current ? { device: current, source: 'flag' } : null
    }
  }
  const ledger = createCrashLedger()
  const reader = createCrashReader({
    runner,
    sdk,
    devices,
    installed: async () => [
      { packageId: 'com.example.player', source: 'sideloaded' },
      { packageId: 'com.amazon.diode', source: 'system' }
    ],
    ledger
  })
  const appended: Omit<ActivityEntry, 'time' | 'surface'>[] = []
  const activity: ActivityLog = opts.activity ?? {
    append: async (entry) => void appended.push(entry)
  }
  const events: string[] = []
  const crashes: Crash[] = []
  const errors: Error[] = []
  const watch = () =>
    createCrashWatch(
      { reader, devices, activity },
      {
        onNew: (crash) => {
          events.push(`new ${crash.id}`)
          crashes.push(crash)
        },
        onAway: () => events.push('away'),
        onBack: () => events.push('back'),
        onError: (e) => {
          events.push(`error ${e instanceof OvdError ? e.code : e.message}`)
          errors.push(e)
        }
      }
    )
  return { runner, state, ledger, appended, events, crashes, errors, watch }
}

const poll = (ms = CRASH_POLL_MS) => vi.advanceTimersByTimeAsync(ms)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('crash watch', () => {
  test('the first poll is a silent baseline, even with reports already in the vault', async () => {
    const { events, appended, watch } = setup({ [LS]: AFTER })
    const w = watch()
    await poll(0)
    expect(events).toEqual([])
    expect(appended).toEqual([])
    w.stop()
  })

  test('polls every 5 s with one vault listing each, and reads no header for a baseline', async () => {
    const { runner, watch } = setup({ [LS]: AFTER })
    const w = watch()
    await poll(0)
    expect(runner.count(LS)).toBe(1)
    await poll()
    expect(runner.count(LS)).toBe(2)
    await poll(CRASH_POLL_MS - 1)
    expect(runner.count(LS)).toBe(2)
    await poll(1)
    expect(runner.count(LS)).toBe(3)
    expect(runner.calls.filter((c) => c.display.includes('base64'))).toEqual([])
    w.stop()
  })

  test('a new report emits exactly once, after its activity entry with validated fields only', async () => {
    const { events, crashes, appended, runner, watch } = setup({ [LS]: [BEFORE, AFTER] })
    const w = watch()
    await poll(0)
    await poll()
    await poll()
    await poll()

    expect(events).toEqual(['new 37'])
    expect(crashes[0]).toMatchObject({
      id: 37,
      package: 'com.example.player',
      kind: 'js',
      signal: 6,
      pid: 3200,
      new: true,
      summary: 'Error: player: deliberate crash right after launch'
    })
    // The header is read once, only for the new report.
    expect(runner.count(acr(37))).toBe(1)
    expect(runner.count(acr(35))).toBe(0)
    expect(appended).toEqual([
      {
        action: 'crash.detected',
        target: 'VirtualDevice',
        args: { package: 'com.example.player', index: 37, pid: 3200, signal: 6, epoch: 1794102704 },
        result: 'ok'
      }
    ])
    // No stack, Source, BootId or log text.
    expect(JSON.stringify(appended)).not.toMatch(/anonymous|Source|BootId|bundle/)
    w.stop()
  })

  test('a burst is announced oldest first, and a system package (com_amazon_diode) never', async () => {
    const { events, watch } = setup({ [LS]: [EMPTY, AFTER] })
    const w = watch()
    await poll(0)
    await poll()
    expect(events).toEqual(['new 35', 'new 37'])
    w.stop()
  })

  test('a crash a launch already reported is not announced again', async () => {
    const { events, ledger, appended, watch } = setup({ [LS]: [BEFORE, AFTER] })
    ledger.add('VirtualDevice', 37)
    const w = watch()
    await poll(0)
    await poll()
    await poll()
    expect(events).toEqual([])
    expect(appended).toEqual([])
    w.stop()
  })

  test('away and back: silent polling while the target is gone, then the gap is marked', async () => {
    const { events, state, runner, watch } = setup({ [LS]: [BEFORE, AFTER] })
    const w = watch()
    await poll(0)

    state.device = { ...device, status: 'offline' }
    await poll()
    await poll()
    await poll()
    // One `away`, and no listing while the target is offline.
    expect(events).toEqual(['away'])
    expect(runner.count(LS)).toBe(1)

    state.device = { ...device, status: 'online' }
    await poll()
    // The report that appeared meanwhile is announced after `back`.
    expect(events).toEqual(['away', 'back', 'new 37'])
    w.stop()
  })

  test('a device that leaves mid-poll (TARGET_OFFLINE) is away too', async () => {
    const gone = { stdout: '', stderr: "error: device 'emulator-5554' not found", exitCode: 1 }
    const { events, watch } = setup({ [LS]: [BEFORE, gone, BEFORE] })
    const w = watch()
    await poll(0)
    await poll()
    await poll()
    expect(events).toEqual(['away', 'back'])
    w.stop()
  })

  test('a target that is offline from the start is silent until it comes back', async () => {
    const { events, state, watch } = setup({ [LS]: [BEFORE, AFTER] })
    state.device = { ...device, status: 'offline' }
    const w = watch()
    await poll(0)
    await poll()
    expect(events).toEqual([])

    state.device = { ...device, status: 'online' }
    // The first read is the baseline, so what is in the vault then is not announced.
    await poll()
    expect(events).toEqual([])
    await poll()
    expect(events).toEqual(['new 37'])
    w.stop()
  })

  test('a --device that disappears from the device list is away', async () => {
    let missing = false
    const { events, watch } = setup(
      { [LS]: BEFORE },
      {
        current: () => {
          if (missing) throw new OvdError('DEVICE_NOT_FOUND', 'No device', 'See ovd devices')
          return device
        }
      }
    )
    const w = watch()
    await poll(0)
    missing = true
    await poll()
    await poll()
    expect(events).toEqual(['away'])
    w.stop()
  })

  test('an error is reported once while it repeats, and polling goes on', async () => {
    const refused = out('loggingctl-vault-acr/insufficient-permissions.json')
    const { events, errors, watch } = setup({ [LS]: [refused, refused, BEFORE, refused] })
    const w = watch()
    await poll(0)
    await poll()
    expect(events).toEqual(['error CRASH_ACCESS_DENIED'])
    await poll()
    await poll()
    expect(events).toEqual(['error CRASH_ACCESS_DENIED', 'error CRASH_ACCESS_DENIED'])
    expect(errors).toHaveLength(2)
    w.stop()
  })

  test('no target is reported as an error', async () => {
    const { events, watch } = setup({ [LS]: BEFORE }, { current: () => null })
    const w = watch()
    await poll(0)
    await poll()
    expect(events).toEqual(['error NO_TARGET'])
    w.stop()
  })

  test('stop ends the polling', async () => {
    const { runner, watch } = setup({ [LS]: BEFORE })
    const w = watch()
    await poll(0)
    w.stop()
    await poll(CRASH_POLL_MS * 3)
    expect(runner.count(LS)).toBe(1)
  })

  test('a failed activity append does not stop the announcement', async () => {
    const { events, watch } = setup(
      { [LS]: [BEFORE, AFTER] },
      { activity: { append: () => Promise.reject(new Error('disk full')) } }
    )
    const w = watch()
    await poll(0)
    await poll()
    expect(events).toEqual(['new 37'])
    w.stop()
  })
})
