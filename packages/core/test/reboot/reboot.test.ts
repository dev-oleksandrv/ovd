import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  createActivityLog,
  createDevices,
  createReboot,
  createSdkLocator,
  createStateStore,
  type ActivityEntry,
  type CommandSpec,
  type HostState,
  type RebootProgress,
  type Runner,
  type RunResult
} from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

const VVD_REBOOT = 'vega exec vda -s emulator-5554 reboot'
const WIFI = '192.0.2.42:5555'
const WIFI_REBOOT = `vega exec vda -s ${WIFI} reboot`
const VDA = 'vega exec vda devices -l'
const STATUS = 'vega virtual-device status'
const VVD_INFO = 'vega device info --device VirtualDevice'
const WIFI_INFO = `vega device info --device ${WIFI}`

const recorded = (path: string) => fixture(`0.24/${path}`)
const line = (path: string, index: number) => recorded(path).split('\n')[index] ?? ''
const HEADER = line('vda-devices/none.txt', 0)
// One device line per state, each from a recording of that device in that state (as the fake
// SDK builds its lists).
const LISTED = {
  vvd: line('vda-devices/stick-usb-and-virtual-device.txt', 2),
  vvdOffline: line('vda-devices/virtual-device-offline.txt', 1),
  wifi: line('vda-devices/stick-wifi.txt', 1),
  wifiOffline: line('vda-devices/stick-wifi-offline.txt', 1)
}

// What the device is doing, from that time on (ms after the test starts).
// `gone`: not listed; `offline`: listed offline; `booting`: listed, info empty; `up`: info reads.
type Phase = 'gone' | 'offline' | 'booting' | 'up'
// A poll that fails: VDA answers with its intermittent error (vda-missing-errno.txt) twice.
type Step = [at: number, phase: Phase | 'vda-broken']

interface Setup {
  device?: 'vvd' | 'wifi'
  // From the reboot on; the device is up before it.
  timeline?: Step[]
  reboot?: Partial<RunResult>
  env?: Record<string, string>
  state?: Partial<HostState>
  // What `pairing.reconnect` answers; a true answer lists the stick again.
  reconnect?: (id: string) => Promise<boolean>
  // Aborts the signal once fake time reaches this.
  abortAt?: number
}

let home: string

beforeEach(async () => {
  home = join(await mkdtemp(join(tmpdir(), 'ovd-reboot-')), 'ovd')
})

function done(spec: CommandSpec, fields: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, durationMs: 0, ...fields, command: spec.display }
}

function setup(opts: Setup = {}) {
  const kind = opts.device ?? 'vvd'
  let clock = 0
  let rebootedAt: number | null = null
  let relisted = false
  const timeline = opts.timeline ?? []
  const phase = (): Phase | 'vda-broken' => {
    if (rebootedAt === null) return 'up'
    if (relisted) return 'up'
    let current: Phase | 'vda-broken' = 'up'
    for (const [at, next] of timeline) if (clock - rebootedAt >= at) current = next
    return current
  }
  const calls: string[] = []
  const runner: Runner = {
    async run(spec) {
      calls.push(spec.display)
      const now = phase()
      switch (spec.display) {
        case VVD_REBOOT:
        case WIFI_REBOOT:
          rebootedAt = clock
          return done(spec, opts.reboot ?? { stdout: recorded('vda-reboot/virtual-device.txt') })
        case STATUS:
          return done(spec, { stdout: recorded('vega-virtual-device-status/running.json') })
        case VDA: {
          if (now === 'vda-broken') {
            return done(spec, {
              stdout: recorded('vda-devices/vda-missing-errno.txt'),
              exitCode: 2
            })
          }
          const lines = [HEADER]
          if (kind === 'vvd') {
            if (now === 'offline') lines.push(LISTED.vvdOffline)
            else if (now !== 'gone') lines.push(LISTED.vvd)
          } else {
            if (now === 'offline') lines.push(LISTED.wifiOffline)
            else if (now !== 'gone') lines.push(LISTED.wifi)
          }
          return done(spec, { stdout: `${lines.join('\n')}\n\n` })
        }
        case VVD_INFO:
          return done(spec, {
            stdout: recorded(
              now === 'up'
                ? 'vega-device-info/virtual-device.json'
                : 'vega-device-info/unavailable.json'
            )
          })
        case WIFI_INFO:
          return done(spec, {
            stdout: recorded(
              now === 'up'
                ? 'vega-device-info/stick-wifi.json'
                : 'vega-device-info/unavailable.json'
            )
          })
      }
      throw new Error(`unexpected ${spec.display}`)
    }
  }
  const sdk = createSdkLocator(async () => ({
    vegaPath: '/sdk/vega',
    cli: 'manager',
    sdkVersion: '0.24.12112',
    cliVersion: '1.4.5'
  }))
  const state = createStateStore(home)
  const activity = createActivityLog({ home, surface: 'cli' })
  const devices = createDevices({ runner, sdk, state, activity, env: {} })
  const reconnects: number[] = []
  const controller = new AbortController()
  const reboot = createReboot({
    runner,
    sdk,
    devices,
    activity,
    env: opts.env ?? {},
    pairing: {
      async reconnect(id) {
        reconnects.push(clock - (rebootedAt ?? 0))
        const ok = (await opts.reconnect?.(id)) ?? false
        if (ok) relisted = true
        return ok
      }
    },
    sleep: async (ms) => {
      clock += ms
      if (opts.abortAt !== undefined && clock >= opts.abortAt) controller.abort()
    },
    now: () => clock
  })
  const ready = state.update((s) => ({
    ...s,
    target: kind === 'vvd' ? 'VirtualDevice' : WIFI,
    ...opts.state
  }))
  const progress: RebootProgress[] = []
  const targets = new Set<string>()
  const run = async (more: { timeoutMs?: number; device?: string } = {}) => {
    await ready
    return reboot.reboot({
      ...more,
      signal: controller.signal,
      onProgress: (p, target) => {
        progress.push(p)
        targets.add(target.id)
      }
    })
  }
  return {
    run,
    calls,
    progress,
    reconnects,
    controller,
    targets,
    elapsed: () => clock - (rebootedAt ?? 0)
  }
}

async function activity(): Promise<Omit<ActivityEntry, 'time' | 'surface'>[]> {
  const text = await readFile(join(home, 'activity.jsonl'), 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const entry: Partial<ActivityEntry> = JSON.parse(l) as ActivityEntry
      delete entry.time
      delete entry.surface
      return entry as Omit<ActivityEntry, 'time' | 'surface'>
    })
    .filter((e) => e.action === 'reboot')
}

// The run recorded on the Virtual Device (ARCHITECTURE §8): gone at ~1 s, offline at ~2 s,
// listed at ~3.5 s with empty info, info readable at ~7 s.
const RECORDED: Step[] = [
  [1_000, 'gone'],
  [2_000, 'offline'],
  [3_500, 'booting'],
  [7_000, 'up']
]

describe('reboot', () => {
  test('the Virtual Device: gone, offline, listed without info, then up for the settle', async () => {
    const { run, calls, progress, targets, elapsed } = setup({ timeline: RECORDED })
    await expect(run()).resolves.toEqual({
      target: { id: 'VirtualDevice', name: 'Vega Virtual Device' },
      seconds: 15,
      reconnected: false
    })
    // Up from 7 s, then 8 s of polls that all read info.
    expect(elapsed()).toBe(15_000)
    expect(calls.filter((c) => c === VVD_REBOOT)).toHaveLength(1)
    expect(progress).toEqual(['rebooting', 'waiting', 'settling'])
    expect([...targets]).toEqual(['VirtualDevice'])
    expect(await activity()).toEqual([
      { action: 'reboot', target: 'VirtualDevice', args: { timeout: '120' }, result: 'ok' }
    ])
  })

  test('the re-list during the settle starts it again', async () => {
    const { run, progress, elapsed } = setup({
      // Up at 7 s, then dropped 4.4 s later for ~2 s and listed again.
      timeline: [...RECORDED, [11_400, 'gone'], [13_400, 'booting'], [14_000, 'up']]
    })
    await expect(run()).resolves.toMatchObject({ seconds: 22 })
    expect(elapsed()).toBe(22_000)
    expect(progress).toEqual(['rebooting', 'waiting', 'settling', 'waiting', 'settling'])
  })

  test('listed without info counts as away when the polls miss the gone window', async () => {
    const { run, elapsed } = setup({
      timeline: [
        [500, 'booting'],
        [5_000, 'up']
      ]
    })
    await expect(run()).resolves.toMatchObject({ seconds: 13 })
    expect(elapsed()).toBe(13_000)
  })

  test('the settle time comes from OVD_REBOOT_SETTLE_MS', async () => {
    const { run, elapsed } = setup({ timeline: RECORDED, env: { OVD_REBOOT_SETTLE_MS: '0' } })
    await expect(run()).resolves.toMatchObject({ seconds: 7 })
    expect(elapsed()).toBe(7_000)
  })

  test.each(['-1', 'soon', '1.5'])('an OVD_REBOOT_SETTLE_MS of %s is ignored', async (value) => {
    const { run, elapsed } = setup({ timeline: RECORDED, env: { OVD_REBOOT_SETTLE_MS: value } })
    await run()
    expect(elapsed()).toBe(15_000)
  })

  test('a device that never goes away didn’t restart', async () => {
    const { run, elapsed } = setup({ timeline: [] })
    await expect(run()).rejects.toMatchObject({
      code: 'REBOOT_FAILED',
      message: 'Vega Virtual Device didn’t restart'
    })
    expect(elapsed()).toBe(30_000)
    expect(await activity()).toEqual([
      {
        action: 'reboot',
        target: 'VirtualDevice',
        args: { timeout: '120' },
        result: 'error',
        errorCode: 'REBOOT_FAILED'
      }
    ])
  })

  test('a failed poll is no observation', async () => {
    const { run, elapsed } = setup({
      timeline: [
        [1_000, 'vda-broken'],
        [3_000, 'booting'],
        [7_000, 'up']
      ]
    })
    await expect(run()).resolves.toMatchObject({ seconds: 15 })
    expect(elapsed()).toBe(15_000)
  })

  test('failed polls don’t count toward the away limit', async () => {
    // 5 failed polls (1–5 s), then 30 answered ones, none away.
    const { run, elapsed } = setup({
      timeline: [
        [500, 'vda-broken'],
        [5_500, 'up']
      ]
    })
    await expect(run()).rejects.toMatchObject({ code: 'REBOOT_FAILED' })
    expect(elapsed()).toBe(35_000)
  })

  test('10 failed polls in a row end the wait with that poll’s error', async () => {
    const { run, elapsed } = setup({ timeline: [[500, 'vda-broken']] })
    await expect(run()).rejects.toMatchObject({ code: 'VDA_UNAVAILABLE' })
    expect(elapsed()).toBe(10_000)
    expect(await activity()).toEqual([
      expect.objectContaining({ result: 'error', errorCode: 'VDA_UNAVAILABLE' })
    ])
  })

  test('a device that doesn’t come back in time times out', async () => {
    const { run, elapsed } = setup({ timeline: [[1_000, 'gone']] })
    await expect(run({ timeoutMs: 30_000 })).rejects.toMatchObject({
      code: 'REBOOT_TIMEOUT',
      message: 'Vega Virtual Device didn’t come back within 30 s',
      hint: 'Restart it with ovd vvd stop, then ovd vvd start'
    })
    expect(elapsed()).toBe(30_000)
    expect(await activity()).toEqual([
      {
        action: 'reboot',
        target: 'VirtualDevice',
        args: { timeout: '30' },
        result: 'error',
        errorCode: 'REBOOT_TIMEOUT'
      }
    ])
  })

  test('an unknown serial is TARGET_OFFLINE', async () => {
    const { run } = setup({
      reboot: { stderr: recorded('vda-reboot/device-not-found.stderr.txt'), exitCode: 1 }
    })
    await expect(run()).rejects.toMatchObject({ code: 'TARGET_OFFLINE' })
    expect(await activity()).toEqual([
      expect.objectContaining({ target: 'VirtualDevice', errorCode: 'TARGET_OFFLINE' })
    ])
  })

  test('any other failure of vda reboot is REBOOT_FAILED', async () => {
    const { run, calls } = setup({
      reboot: { stderr: recorded('vda-shell/virtual-device-offline.stderr.txt'), exitCode: 1 }
    })
    await expect(run()).rejects.toMatchObject({
      code: 'REBOOT_FAILED',
      message: 'Couldn’t reboot Vega Virtual Device: error: device offline (transport offline)'
    })
    expect(calls.filter((c) => c === VDA)).toHaveLength(1)
  })

  test('an offline target is refused before vda reboot, logged without a target', async () => {
    const { run, calls } = setup({ state: { target: WIFI } })
    await expect(run()).rejects.toMatchObject({ code: 'TARGET_OFFLINE' })
    expect(calls).not.toContain(WIFI_REBOOT)
    expect(await activity()).toEqual([
      {
        action: 'reboot',
        target: null,
        args: { timeout: '120' },
        result: 'error',
        errorCode: 'TARGET_OFFLINE'
      }
    ])
  })

  test('an unknown device is logged with a null target', async () => {
    const { run, calls } = setup()
    await expect(run({ device: 'G070000000000009' })).rejects.toMatchObject({
      code: 'DEVICE_NOT_FOUND'
    })
    expect(calls).not.toContain(VVD_REBOOT)
    expect(await activity()).toEqual([
      {
        action: 'reboot',
        target: null,
        args: { timeout: '120' },
        result: 'error',
        errorCode: 'DEVICE_NOT_FOUND'
      }
    ])
  })

  test('an abort before vda reboot sends nothing and writes nothing', async () => {
    const { run, calls, controller } = setup({ timeline: RECORDED })
    controller.abort()
    await expect(run()).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).not.toContain(VVD_REBOOT)
    expect(await activity()).toEqual([])
  })

  test('an abort after vda reboot is logged: the device reboots anyway', async () => {
    const { run, calls } = setup({ timeline: RECORDED, abortAt: 3_000 })
    await expect(run()).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls.filter((c) => c === VVD_REBOOT)).toHaveLength(1)
    expect(await activity()).toEqual([
      {
        action: 'reboot',
        target: 'VirtualDevice',
        args: { timeout: '120', wait: 'cancelled' },
        result: 'ok'
      }
    ])
  })
})

describe('reboot over Wi‑Fi', () => {
  const saved = { saved: [{ id: WIFI, savedAt: '2026-10-30T00:00:00.000Z' }] }

  test('a saved stick VDA stops listing is reconnected after 10 s', async () => {
    const { run, calls, progress, reconnects, elapsed } = setup({
      device: 'wifi',
      state: saved,
      timeline: [[1_000, 'gone']],
      reconnect: async () => true
    })
    await expect(run()).resolves.toEqual({
      target: { id: WIFI, name: 'Fire TV stick' },
      seconds: 20,
      reconnected: true
    })
    expect(calls).toContain(WIFI_REBOOT)
    // Unlisted from 1 s, so the connect goes at 11 s; back at 12 s, settled at 20 s.
    expect(reconnects).toEqual([11_000])
    expect(elapsed()).toBe(20_000)
    expect(progress).toEqual(['rebooting', 'waiting', 'reconnecting', 'waiting', 'settling'])
  })

  test('a failed reconnect is retried every 10 s', async () => {
    const { run, reconnects } = setup({
      device: 'wifi',
      state: saved,
      timeline: [[1_000, 'gone']],
      reconnect: async () => false
    })
    await expect(run({ timeoutMs: 40_000 })).rejects.toMatchObject({
      code: 'REBOOT_TIMEOUT',
      hint: 'Check the stick is on and connected, then check with ovd devices'
    })
    expect(reconnects).toEqual([11_000, 21_000, 31_000])
  })

  test('an unsaved stick VDA stops listing is unknown, and reconnected too', async () => {
    const { run, reconnects } = setup({
      device: 'wifi',
      state: { target: undefined },
      timeline: [[1_000, 'gone']],
      reconnect: async () => true
    })
    await expect(run({ device: WIFI })).resolves.toMatchObject({ reconnected: true })
    expect(reconnects).toEqual([11_000])
  })

  test('a stick VDA still lists offline is left to VDA', async () => {
    const { run, reconnects } = setup({
      device: 'wifi',
      state: saved,
      timeline: [[1_000, 'offline']],
      reconnect: async () => true
    })
    await expect(run({ timeoutMs: 30_000 })).rejects.toMatchObject({ code: 'REBOOT_TIMEOUT' })
    expect(reconnects).toEqual([])
  })
})
