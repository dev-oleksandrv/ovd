import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  createActivityLog,
  createDevices,
  createSdkLocator,
  createStateStore,
  createVvd,
  type ActivityEntry
} from '../../src/index.js'
import { FakeRunner } from '../support/fakeRunner.js'
import { fixture } from '../support/fixtures.js'

const VDA = 'vega exec vda devices -l'
const STATUS = 'vega virtual-device status'
const START = 'vega virtual-device start'
const STOP = 'vega virtual-device stop'
const STICK_INFO = 'vega device info --device G070000000000001'
const VVD_INFO = 'vega device info --device VirtualDevice'
const VSM = 'vega exec vda -s emulator-5554 shell vsm developer-mode'
const VSM_ENABLE = `${VSM} enable`

const out = (path: string) => ({ stdout: fixture(`0.24/${path}`) })
const err = (path: string, exitCode: number) => ({ stderr: fixture(`0.24/${path}`), exitCode })

// VDA lists and Virtual Device statuses for a stick plus the Virtual Device in each state.
const stopped = {
  vda: out('vda-devices/stick-usb.txt'),
  status: out('vega-virtual-device-status/stopped.json')
}
const booting = {
  vda: out('vda-devices/stick-usb.txt'),
  status: out('vega-virtual-device-status/running.json')
}
const online = {
  vda: out('vda-devices/stick-usb-and-virtual-device.txt'),
  status: out('vega-virtual-device-status/running.json')
}
type Phase = typeof online

// One device list per phase, in order; the last phase repeats.
function phases(...list: Phase[]) {
  return {
    [VDA]: list.map((p) => p.vda),
    [STATUS]: list.map((p) => p.status),
    [STICK_INFO]: out('vega-device-info/stick-usb.json'),
    [VVD_INFO]: out('vega-device-info/virtual-device.json')
  }
}

let home: string

beforeEach(async () => {
  home = join(await mkdtemp(join(tmpdir(), 'ovd-vvd-')), 'ovd')
})

function setup(script: ConstructorParameters<typeof FakeRunner>[0]) {
  const runner = new FakeRunner(script)
  const sdk = createSdkLocator(async () => ({
    vegaPath: '/sdk/vega',
    cli: 'manager',
    sdkVersion: '0.24.12112',
    cliVersion: '1.4.5'
  }))
  const activity = createActivityLog({ home, surface: 'cli' })
  const devices = createDevices({ runner, sdk, state: createStateStore(home), activity, env: {} })
  const sleeps: number[] = []
  const vvd = createVvd({
    runner,
    sdk,
    devices,
    activity,
    sleep: async (ms) => {
      sleeps.push(ms)
    }
  })
  return { vvd, devices, runner, sleeps }
}

async function activity(): Promise<Pick<ActivityEntry, 'action' | 'result' | 'errorCode'>[]> {
  const text = await readFile(join(home, 'activity.jsonl'), 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const { action, result, errorCode } = JSON.parse(line) as ActivityEntry
      return errorCode === undefined ? { action, result } : { action, result, errorCode }
    })
}

describe('Vvd.status', () => {
  test.each([
    ['online', online, true],
    ['starting', booting, true],
    ['stopped', stopped, false]
  ] as const)('%s', async (status, phase, running) => {
    const { vvd } = setup(phases(phase))
    expect(await vvd.status()).toMatchObject({ status, running, device: { id: 'VirtualDevice' } })
  })

  test('an SDK without a Virtual Device', async () => {
    const { vvd } = setup({ ...phases(stopped), [STATUS]: { exitCode: 1 } })
    await expect(vvd.status()).rejects.toMatchObject({ code: 'VVD_NOT_INSTALLED' })
  })
})

describe('Vvd.start', () => {
  test('starts a stopped Virtual Device and returns once VDA lists it', async () => {
    const { vvd, runner } = setup({
      ...phases(stopped, booting, online),
      [START]: out('vega-virtual-device-start/started.txt')
    })
    const state = await vvd.start()
    expect(state).toMatchObject({
      status: 'online',
      running: true,
      device: { id: 'VirtualDevice', status: 'online', info: { architecture: 'aarch64' } }
    })
    expect(runner.count(START)).toBe(1)
    expect(runner.calls.find((c) => c.display === START)?.timeoutMs).toBe(120_000)
    expect(await activity()).toEqual([{ action: 'vvd.start', result: 'ok' }])
  })

  test('already online: nothing runs', async () => {
    const { vvd, runner } = setup(phases(online))
    expect(await vvd.start()).toMatchObject({ status: 'online' })
    expect(runner.count(START)).toBe(0)
  })

  test('booting: waits for it without starting another', async () => {
    const { vvd, runner } = setup(phases(booting, booting, online))
    expect(await vvd.start()).toMatchObject({ status: 'online' })
    expect(runner.count(START)).toBe(0)
  })

  test('start fails: VVD_START_FAILED with the last stderr line', async () => {
    const { vvd } = setup({
      ...phases(stopped),
      [START]: { exitCode: 1, stderr: '2026/10/30 [INFO] log line\nqemu: could not start' }
    })
    await expect(vvd.start()).rejects.toMatchObject({
      code: 'VVD_START_FAILED',
      details: { exitCode: 1, stderr: 'qemu: could not start' }
    })
    expect(await activity()).toEqual([
      { action: 'vvd.start', result: 'error', errorCode: 'VVD_START_FAILED' }
    ])
  })

  test('started but never listed: gives up after 30 polls', async () => {
    const { vvd, sleeps } = setup({
      ...phases(stopped, booting),
      [START]: out('vega-virtual-device-start/started.txt')
    })
    await expect(vvd.start()).rejects.toMatchObject({
      code: 'VVD_START_FAILED',
      message: 'The Virtual Device started, but VDA doesn’t list it'
    })
    expect(sleeps).toHaveLength(30)
  })

  test('abort: passes the signal on and logs nothing', async () => {
    const controller = new AbortController()
    const { vvd, runner } = setup({
      ...phases(stopped, booting),
      [START]: out('vega-virtual-device-start/started.txt')
    })
    controller.abort()
    await expect(vvd.start({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(runner.calls.find((c) => c.display === START)?.signal).toBe(controller.signal)
    expect(await activity()).toEqual([])
  })
})

describe('Vvd.stop', () => {
  test('stops a running Virtual Device', async () => {
    const { vvd, runner } = setup({ ...phases(online, stopped), [STOP]: {} })
    expect(await vvd.stop()).toMatchObject({ status: 'stopped', running: false })
    expect(runner.count(STOP)).toBe(1)
    expect(await activity()).toEqual([{ action: 'vvd.stop', result: 'ok' }])
  })

  test('already stopped: nothing runs', async () => {
    const { vvd, runner } = setup(phases(stopped))
    expect(await vvd.stop()).toMatchObject({ status: 'stopped' })
    expect(runner.count(STOP)).toBe(0)
  })

  test('stopped elsewhere in the meantime counts as stopped', async () => {
    const { vvd } = setup({
      ...phases(online, stopped),
      [STOP]: err('vega-virtual-device-stop/not-running.stderr.txt', 1)
    })
    expect(await vvd.stop()).toMatchObject({ status: 'stopped' })
  })

  test('stop fails: VVD_STOP_FAILED', async () => {
    const { vvd } = setup({ ...phases(online), [STOP]: { exitCode: 2, stderr: 'boom' } })
    await expect(vvd.stop()).rejects.toMatchObject({ code: 'VVD_STOP_FAILED' })
    expect(await activity()).toEqual([
      { action: 'vvd.stop', result: 'error', errorCode: 'VVD_STOP_FAILED' }
    ])
  })

  test('still listed after stop: VVD_STOP_FAILED after 15 polls', async () => {
    const { vvd, sleeps } = setup({ ...phases(online), [STOP]: {} })
    await expect(vvd.stop()).rejects.toMatchObject({ code: 'VVD_STOP_FAILED' })
    expect(sleeps).toHaveLength(15)
  })
})

describe('Vvd Developer Mode', () => {
  test.each([
    ['vsm-developer-mode/enabled.txt', true],
    ['vsm-developer-mode/disabled.txt', false]
  ])('reads %s', async (file, developerMode) => {
    const { vvd } = setup({ ...phases(online), [VSM]: out(file) })
    expect(await vvd.developerMode()).toEqual({ developerMode, command: VSM })
  })

  test('shell not answering after Developer Mode was turned off', async () => {
    const { vvd } = setup({
      ...phases(online),
      [VSM]: err('vsm-developer-mode/shell-service-down.stderr.txt', 1)
    })
    await expect(vvd.developerMode()).rejects.toMatchObject({ code: 'COMMAND_FAILED' })
  })

  test.each([stopped, booting])('needs the Virtual Device online', async (phase) => {
    const { vvd, runner } = setup(phases(phase))
    await expect(vvd.developerMode()).rejects.toMatchObject({ code: 'TARGET_OFFLINE' })
    await expect(vvd.enableDeveloperMode()).rejects.toMatchObject({ code: 'TARGET_OFFLINE' })
    expect(runner.count(VSM_ENABLE)).toBe(0)
  })

  test('enable turns it on and re-reads device info', async () => {
    const { vvd, devices, runner } = setup({
      ...phases(online),
      [VVD_INFO]: [
        out('vega-device-info/virtual-device-developer-mode-off.json'),
        out('vega-device-info/virtual-device.json')
      ],
      [VSM_ENABLE]: out('vsm-developer-mode-set/enabled.txt')
    })
    const vvdInfo = async () =>
      (await devices.list()).devices.find((d) => d.id === 'VirtualDevice')?.info?.developerMode
    expect(await vvdInfo()).toBe(false)
    expect(await vvd.enableDeveloperMode()).toEqual({ developerMode: true })
    expect(await vvdInfo()).toBe(true)
    expect(runner.count(VVD_INFO)).toBe(2)
    expect(await activity()).toEqual([{ action: 'vvd.devmode.enable', result: 'ok' }])
  })

  test('enable fails: VVD_DEVMODE_FAILED', async () => {
    const { vvd } = setup({
      ...phases(online),
      [VSM_ENABLE]: err('vsm-developer-mode/shell-service-down.stderr.txt', 1)
    })
    await expect(vvd.enableDeveloperMode()).rejects.toMatchObject({ code: 'VVD_DEVMODE_FAILED' })
    expect(await activity()).toEqual([
      { action: 'vvd.devmode.enable', result: 'error', errorCode: 'VVD_DEVMODE_FAILED' }
    ])
  })
})
