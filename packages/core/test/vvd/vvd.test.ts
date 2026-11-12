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
  OvdError,
  type ActivityEntry,
  type Device,
  type Emulator
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

// What the fake emulator's `enableGrpc` does on each attempt, in order; the last repeats.
type Enable = 'on' | 'refused' | 'rejected' | 'abort' | 'bug'

const refused = () =>
  new OvdError(
    'VVD_GRPC_FAILED',
    'Couldn’t reach the emulator console on port 5554 (ECONNREFUSED)',
    'Check that the Virtual Device is running, then run ovd vvd start again',
    { retryable: true }
  )

function fakeEmulator(enables: Enable[] = ['on']) {
  const attempts: { serial: string; signal: AbortSignal | undefined }[] = []
  const probes: string[] = []
  const emulator: Emulator = {
    grpcPort: 8554,
    async enableGrpc(serial, opts = {}) {
      attempts.push({ serial, signal: opts.signal })
      const step = enables[Math.min(attempts.length, enables.length) - 1]
      if (step === 'refused') throw refused()
      if (step === 'rejected') {
        throw new OvdError(
          'VVD_GRPC_FAILED',
          'The emulator console rejected the token in ~/.emulator_console_auth_token',
          'Restart the Virtual Device with ovd vvd stop, then ovd vvd start',
          { retryable: false }
        )
      }
      if (step === 'abort') throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      if (step === 'bug') throw new TypeError('a bug')
      return { port: 8554 }
    },
    async grpc(serial) {
      probes.push(serial)
      return { status: 'on', port: 8554 }
    },
    async sendKeys() {
      throw new Error('vvd must not send keys')
    },
    async screenshot() {
      throw new Error('vvd must not take screenshots')
    },
    async streamScreenshot() {
      throw new Error('vvd must not stream the screen')
    }
  }
  return { emulator, attempts, probes }
}

function setup(script: ConstructorParameters<typeof FakeRunner>[0], enables?: Enable[]) {
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
  const fake = fakeEmulator(enables)
  const vvd = createVvd({
    runner,
    sdk,
    devices,
    activity,
    emulator: fake.emulator,
    sleep: async (ms, signal) => {
      signal?.throwIfAborted()
      sleeps.push(ms)
    }
  })
  return { vvd, devices, runner, sleeps, ...fake }
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
    expect(state.grpc).toEqual({ status: 'on', port: 8554 })
    expect(await activity()).toEqual([
      { action: 'vvd.start', result: 'ok' },
      { action: 'vvd.grpc.enable', result: 'ok' }
    ])
  })

  test('already online: nothing starts, gRPC is still turned on', async () => {
    const { vvd, runner, attempts } = setup(phases(online))
    expect(await vvd.start()).toMatchObject({ status: 'online', grpc: { status: 'on' } })
    expect(runner.count(START)).toBe(0)
    expect(attempts.map((a) => a.serial)).toEqual(['emulator-5554'])
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

describe('Vvd.start: emulator gRPC', () => {
  test('a console that isn’t up yet is retried 1 s apart', async () => {
    const { vvd, attempts, sleeps } = setup(phases(online), ['refused', 'refused', 'on'])
    const controller = new AbortController()
    expect((await vvd.start({ signal: controller.signal })).grpc).toEqual({
      status: 'on',
      port: 8554
    })
    expect(attempts).toHaveLength(3)
    expect(attempts.every((a) => a.signal === controller.signal)).toBe(true)
    expect(sleeps).toEqual([1_000, 1_000])
  })

  test('still refused after 10 attempts: the start resolves with gRPC failed', async () => {
    const { vvd, attempts, sleeps } = setup(phases(online), ['refused'])
    const result = await vvd.start()
    expect(result).toMatchObject({ status: 'online', running: true })
    expect(result.grpc).toEqual({
      status: 'failed',
      error: {
        code: 'VVD_GRPC_FAILED',
        message: 'Couldn’t reach the emulator console on port 5554 (ECONNREFUSED)',
        hint: 'Check that the Virtual Device is running, then run ovd vvd start again'
      }
    })
    expect(attempts).toHaveLength(10)
    expect(sleeps).toHaveLength(9)
    expect(await activity()).toEqual([
      { action: 'vvd.start', result: 'ok' },
      { action: 'vvd.grpc.enable', result: 'error', errorCode: 'VVD_GRPC_FAILED' }
    ])
  })

  test('a refusal such as a wrong token is not retried', async () => {
    const { vvd, attempts, sleeps } = setup(phases(online), ['rejected'])
    expect((await vvd.start()).grpc).toMatchObject({
      status: 'failed',
      error: { code: 'VVD_GRPC_FAILED' }
    })
    expect(attempts).toHaveLength(1)
    expect(sleeps).toEqual([])
  })

  test('the activity entry names the port it asked for', async () => {
    const { vvd } = setup(phases(online))
    await vvd.start()
    const lines = (await readFile(join(home, 'activity.jsonl'), 'utf8')).trim().split('\n')
    expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({
      action: 'vvd.grpc.enable',
      target: 'VirtualDevice',
      args: { port: '8554' }
    })
  })

  test('an abort during the retry wait rejects and logs no gRPC entry', async () => {
    const controller = new AbortController()
    const { vvd, attempts } = setup(phases(online), ['refused'])
    const sleepAbort = vvd.start({ signal: controller.signal })
    controller.abort()
    await expect(sleepAbort).rejects.toMatchObject({ name: 'AbortError' })
    expect(attempts.length).toBeLessThan(10)
    expect(await activity()).toEqual([{ action: 'vvd.start', result: 'ok' }])
  })

  test.each(['abort', 'bug'] as const)('an %s from the emulator propagates', async (step) => {
    const { vvd } = setup(phases(online), [step])
    await expect(vvd.start()).rejects.toMatchObject({
      name: step === 'abort' ? 'AbortError' : 'TypeError'
    })
    expect(await activity()).toEqual([{ action: 'vvd.start', result: 'ok' }])
  })

  test('a failed start doesn’t try gRPC', async () => {
    const { vvd, attempts } = setup({ ...phases(stopped), [START]: { exitCode: 1, stderr: 'x' } })
    await expect(vvd.start()).rejects.toMatchObject({ code: 'VVD_START_FAILED' })
    expect(attempts).toEqual([])
  })
})

describe('Vvd.grpc', () => {
  const device = (status: Device['status'], vdaSerial?: string): Device => ({
    id: 'VirtualDevice',
    serial: 'VirtualDevice',
    name: 'Vega Virtual Device',
    kind: 'vvd',
    connection: 'local',
    status,
    isTarget: false,
    saved: false,
    ...(vdaSerial ? { vdaSerial } : {})
  })

  test.each([
    [device('stopped'), { status: 'not-running' }, []],
    [device('starting'), { status: 'starting' }, []],
    [device('online', 'emulator-5556'), { status: 'on', port: 8554 }, ['emulator-5556']],
    [device('online'), { status: 'on', port: 8554 }, ['emulator-5554']]
  ])('%#: probes only an online device, with no device list', async (d, expected, probed) => {
    const { vvd, probes, runner } = setup(phases(online))
    expect(await vvd.grpc(d)).toEqual(expected)
    expect(probes).toEqual(probed)
    expect(runner.calls).toEqual([])
  })
})

describe('Vvd.ensureGrpc', () => {
  const vvdDevice = (status: Device['status']): Device => ({
    id: 'VirtualDevice',
    serial: 'VirtualDevice',
    vdaSerial: 'emulator-5556',
    name: 'Vega Virtual Device',
    kind: 'vvd',
    connection: 'local',
    status,
    isTarget: false,
    saved: false
  })

  test('turns gRPC on for the device’s VDA serial and logs it once', async () => {
    const { vvd, attempts, runner } = setup(phases(online))
    expect(await vvd.ensureGrpc(vvdDevice('online'))).toEqual({ port: 8554 })
    expect(attempts.map((a) => a.serial)).toEqual(['emulator-5556'])
    expect(runner.calls).toEqual([])
    expect(await activity()).toEqual([{ action: 'vvd.grpc.enable', result: 'ok' }])
  })

  test('retries a console that isn’t up yet, as start does', async () => {
    const { vvd, attempts, sleeps } = setup(phases(online), ['refused', 'on'])
    await vvd.ensureGrpc(vvdDevice('online'))
    expect(attempts).toHaveLength(2)
    expect(sleeps).toEqual([1_000])
  })

  test('a refusal throws VVD_GRPC_FAILED and is logged as an error', async () => {
    const { vvd } = setup(phases(online), ['rejected'])
    await expect(vvd.ensureGrpc(vvdDevice('online'))).rejects.toMatchObject({
      code: 'VVD_GRPC_FAILED'
    })
    expect(await activity()).toEqual([
      { action: 'vvd.grpc.enable', result: 'error', errorCode: 'VVD_GRPC_FAILED' }
    ])
  })

  // An enable that waits until the test lets it answer.
  function held(fake: ReturnType<typeof setup>) {
    let release = (): void => undefined
    fake.emulator.enableGrpc = (serial, opts = {}) => {
      fake.attempts.push({ serial, signal: opts.signal })
      return new Promise((resolve) => {
        release = () => resolve({ port: 8554 })
      })
    }
    return { release: () => release() }
  }

  test('calls while one runs share it: one console enable, one activity entry', async () => {
    const fake = setup(phases(online))
    const gate = held(fake)
    const first = fake.vvd.ensureGrpc(vvdDevice('online'))
    const second = fake.vvd.ensureGrpc(vvdDevice('online'))
    await Promise.resolve()
    gate.release()
    expect(await Promise.all([first, second])).toEqual([{ port: 8554 }, { port: 8554 }])
    expect(fake.attempts).toHaveLength(1)
    // The shared enable runs without any one caller's signal.
    expect(fake.attempts[0]?.signal).toBeUndefined()
    expect(await activity()).toEqual([{ action: 'vvd.grpc.enable', result: 'ok' }])
  })

  test('a failed enable is shared too, and a later call runs a new one', async () => {
    const fake = setup(phases(online), ['rejected', 'on'])
    const both = await Promise.allSettled([
      fake.vvd.ensureGrpc(vvdDevice('online')),
      fake.vvd.ensureGrpc(vvdDevice('online'))
    ])
    expect(both.map((r) => r.status)).toEqual(['rejected', 'rejected'])
    expect(fake.attempts).toHaveLength(1)
    expect(await fake.vvd.ensureGrpc(vvdDevice('online'))).toEqual({ port: 8554 })
    expect(fake.attempts).toHaveLength(2)
    expect(await activity()).toEqual([
      { action: 'vvd.grpc.enable', result: 'error', errorCode: 'VVD_GRPC_FAILED' },
      { action: 'vvd.grpc.enable', result: 'ok' }
    ])
  })

  test('the first caller aborts: it stops waiting, and the second still gets gRPC on', async () => {
    const fake = setup(phases(online))
    const gate = held(fake)
    const controller = new AbortController()
    const first = fake.vvd.ensureGrpc(vvdDevice('online'), controller.signal)
    const second = fake.vvd.ensureGrpc(vvdDevice('online'))
    controller.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    gate.release()
    expect(await second).toEqual({ port: 8554 })
    expect(fake.attempts).toHaveLength(1)
    expect(await activity()).toEqual([{ action: 'vvd.grpc.enable', result: 'ok' }])
  })

  test('an already aborted signal rejects at once', async () => {
    const fake = setup(phases(online))
    held(fake)
    await expect(
      fake.vvd.ensureGrpc(vvdDevice('online'), AbortSignal.abort())
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('a stopped Virtual Device is TARGET_OFFLINE, and the console isn’t tried', async () => {
    const { vvd, attempts } = setup(phases(stopped))
    await expect(vvd.ensureGrpc(vvdDevice('stopped'))).rejects.toMatchObject({
      code: 'TARGET_OFFLINE',
      hint: 'Start it with ovd vvd start'
    })
    expect(attempts).toEqual([])
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
