import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  createActivityLog,
  createDevices,
  createSdkLocator,
  createStateStore,
  type Devices,
  type HostState
} from '../../src/index.js'
import { FakeRunner } from '../support/fakeRunner.js'
import { fixture } from '../support/fixtures.js'

const VDA = 'vega exec vda devices -l'
const VVD = 'vega virtual-device status'
const STICK_INFO = 'vega device info --device G070000000000001'
const VVD_INFO = 'vega device info --device VirtualDevice'

const out = (path: string) => ({ stdout: fixture(`0.24/${path}`) })
const stickAndVvd = () => ({
  [VDA]: out('vda-devices/stick-usb-and-virtual-device.txt'),
  [VVD]: out('vega-virtual-device-status/running.json'),
  [STICK_INFO]: out('vega-device-info/stick-usb.json'),
  [VVD_INFO]: out('vega-device-info/virtual-device.json')
})
const stickOnly = () => ({
  [VDA]: out('vda-devices/stick-usb.txt'),
  [VVD]: out('vega-virtual-device-status/stopped.json'),
  [STICK_INFO]: out('vega-device-info/stick-usb.json')
})

let home: string

beforeEach(async () => {
  home = join(await mkdtemp(join(tmpdir(), 'ovd-devices-')), 'ovd')
})

function setup(
  script: ConstructorParameters<typeof FakeRunner>[0],
  opts: { state?: Partial<HostState>; env?: Record<string, string> } = {}
): { devices: Devices; runner: FakeRunner; seed: () => Promise<void> } {
  const runner = new FakeRunner(script)
  const state = createStateStore(home)
  const devices = createDevices({
    runner,
    sdk: createSdkLocator(async () => ({
      vegaPath: '/sdk/vega',
      cli: 'manager',
      sdkVersion: '0.24.12112',
      cliVersion: '1.4.5'
    })),
    state,
    activity: createActivityLog({ home, surface: 'cli' }),
    env: opts.env ?? {}
  })
  const seed = async () => {
    if (opts.state) await state.update((s) => ({ ...s, ...opts.state }))
  }
  return { devices, runner, seed }
}

const infoCalls = (runner: FakeRunner, display: string) =>
  runner.calls.filter((c) => c.display === display).length

describe('Devices.list', () => {
  test('a USB stick and a running Virtual Device', async () => {
    const { devices } = setup(stickAndVvd())
    const snapshot = await devices.list()
    expect(snapshot.target).toBeNull()
    expect(snapshot.devices).toMatchObject([
      {
        id: 'G070000000000001',
        vdaSerial: 'G070000000000001',
        serial: 'G070000000000001',
        name: 'Fire TV stick',
        kind: 'stick',
        connection: 'usb',
        status: 'online',
        isTarget: false,
        saved: false,
        info: { architecture: 'armv7', os: 'OS 2.0' }
      },
      {
        id: 'VirtualDevice',
        vdaSerial: 'emulator-5554',
        serial: 'VirtualDevice',
        name: 'Vega Virtual Device',
        kind: 'vvd',
        connection: 'local',
        status: 'online',
        info: { architecture: 'aarch64', simulated: true }
      }
    ])
  })

  test('a stopped Virtual Device is listed, and the only online device is the target', async () => {
    const { devices } = setup(stickOnly())
    const snapshot = await devices.list()
    expect(snapshot.target).toBe('G070000000000001')
    expect(snapshot.devices.map((d) => [d.id, d.status, d.isTarget])).toEqual([
      ['G070000000000001', 'online', true],
      ['VirtualDevice', 'stopped', false]
    ])
    expect(snapshot.devices[1]).not.toHaveProperty('info')
    expect(await devices.currentTarget()).toMatchObject({ source: 'only-online' })
  })

  test('a running Virtual Device that VDA does not list yet is starting', async () => {
    const { devices } = setup({
      ...stickOnly(),
      [VVD]: out('vega-virtual-device-status/running.json')
    })
    const vvd = (await devices.list()).devices.find((d) => d.id === 'VirtualDevice')
    expect(vvd).toMatchObject({ status: 'starting' })
  })

  test('no Virtual Device row when the SDK has none', async () => {
    const { devices } = setup({ ...stickOnly(), [VVD]: { exitCode: 1 } })
    expect((await devices.list()).devices.map((d) => d.id)).toEqual(['G070000000000001'])
  })

  test('nothing attached', async () => {
    const { devices } = setup({
      [VDA]: out('vda-devices/none.txt'),
      [VVD]: out('vega-virtual-device-status/stopped.json')
    })
    expect(await devices.list()).toMatchObject({
      target: null,
      devices: [{ id: 'VirtualDevice', status: 'stopped' }]
    })
  })

  test('VDA failing is VDA_UNAVAILABLE', async () => {
    const { devices } = setup({ ...stickOnly(), [VDA]: { exitCode: 1 } })
    await expect(devices.list()).rejects.toMatchObject({ code: 'VDA_UNAVAILABLE' })
  })

  test('the intermittent "No such file or directory: vda" failure is retried once', async () => {
    const script = stickOnly()
    const flake = { stdout: fixture('0.24/vda-devices/vda-missing-errno.txt'), exitCode: 2 }
    const runner = setup(script)
    // The fake replays one result per key, so swap it after the first VDA call.
    let calls = 0
    const original = runner.runner.run.bind(runner.runner)
    runner.runner.run = async (spec) => {
      if (spec.display === VDA && calls++ === 0) {
        return { stderr: '', durationMs: 0, command: VDA, ...flake }
      }
      return original(spec)
    }
    expect((await runner.devices.list()).devices[0]).toMatchObject({ status: 'online' })

    const { devices } = setup({ ...script, [VDA]: flake })
    await expect(devices.list()).rejects.toMatchObject({ code: 'VDA_UNAVAILABLE' })
  })

  test('info that is not available yet is retried on the next list, then cached', async () => {
    const script = { ...stickOnly(), [STICK_INFO]: out('vega-device-info/unavailable.json') }
    const { devices, runner } = setup(script)
    expect((await devices.list()).devices[0]).not.toHaveProperty('info')
    script[STICK_INFO] = out('vega-device-info/stick-usb.json')
    expect((await devices.list()).devices[0]?.info?.architecture).toBe('armv7')
    await devices.list()
    expect(infoCalls(runner, STICK_INFO)).toBe(2)
  })

  test('a stored name wins over the default', async () => {
    const { devices, seed } = setup(stickOnly(), {
      state: { names: { G070000000000001: 'Living room stick' } }
    })
    await seed()
    expect((await devices.list()).devices[0]?.name).toBe('Living room stick')
  })

  test('two known sticks get the last four of their serial', async () => {
    const { devices, seed } = setup(stickOnly(), {
      state: {
        saved: [
          { id: '192.0.2.77:5555', serial: 'G070000000000002', savedAt: '2026-10-29T10:00:00.000Z' }
        ]
      }
    })
    await seed()
    const snapshot = await devices.list()
    expect(snapshot.devices.map((d) => [d.id, d.name, d.status, d.saved])).toEqual([
      ['G070000000000001', 'Fire TV stick 0001', 'online', false],
      ['VirtualDevice', 'Vega Virtual Device', 'stopped', false],
      ['192.0.2.77:5555', 'Fire TV stick 0002', 'offline', true]
    ])
  })

  test('VEGA_SERIAL accepts the VDA alias of the Virtual Device', async () => {
    const { devices } = setup(stickAndVvd(), { env: { VEGA_SERIAL: 'emulator-5554' } })
    expect((await devices.list()).target).toBe('VirtualDevice')
    expect(await devices.currentTarget()).toMatchObject({
      device: { id: 'VirtualDevice' },
      source: 'env'
    })
  })

  test('a remembered target that is unplugged stays the target, offline', async () => {
    const { devices, seed } = setup(stickOnly(), { state: { target: 'G070000000000002' } })
    await seed()
    const snapshot = await devices.list()
    expect(snapshot.target).toBe('G070000000000002')
    expect(snapshot.devices.at(-1)).toMatchObject({
      id: 'G070000000000002',
      status: 'offline',
      isTarget: true,
      kind: 'stick'
    })
    expect(snapshot.devices[0]).toMatchObject({ id: 'G070000000000001', isTarget: false })
  })

  test('an explicit --device must exist; the VDA alias resolves', async () => {
    const { devices } = setup(stickAndVvd())
    await expect(devices.currentTarget('NOPE')).rejects.toMatchObject({
      code: 'DEVICE_NOT_FOUND'
    })
    expect(await devices.currentTarget('emulator-5554')).toMatchObject({
      device: { id: 'VirtualDevice' },
      source: 'flag'
    })
  })
})

const activity = async () =>
  (await readFile(join(home, 'activity.jsonl'), 'utf8'))
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>)

describe('Devices actions', () => {
  test('rename trims, stores the name by serial and logs it', async () => {
    const { devices } = setup(stickOnly())
    const device = await devices.rename('G070000000000001', '  Living room stick ')
    expect(device).toMatchObject({ id: 'G070000000000001', name: 'Living room stick' })
    const state = JSON.parse(await readFile(join(home, 'state.json'), 'utf8')) as HostState
    expect(state.names).toEqual({ G070000000000001: 'Living room stick' })
    expect(await activity()).toMatchObject([
      {
        surface: 'cli',
        action: 'device.rename',
        target: 'G070000000000001',
        args: { name: 'Living room stick' },
        result: 'ok'
      }
    ])
  })

  test.each(['   ', 'x'.repeat(65)])('rename rejects %j and logs the error', async (name) => {
    const { devices } = setup(stickOnly())
    await expect(devices.rename('G070000000000001', name)).rejects.toMatchObject({
      code: 'INVALID_NAME'
    })
    expect(await activity()).toMatchObject([
      { action: 'device.rename', result: 'error', errorCode: 'INVALID_NAME' }
    ])
  })

  test('setTarget accepts the VDA alias, remembers the canonical ID and logs it', async () => {
    const { devices } = setup(stickAndVvd())
    expect(await devices.setTarget('emulator-5554')).toMatchObject({
      id: 'VirtualDevice',
      isTarget: true
    })
    const state = JSON.parse(await readFile(join(home, 'state.json'), 'utf8')) as HostState
    expect(state.target).toBe('VirtualDevice')
    expect((await devices.list()).target).toBe('VirtualDevice')
    expect(await activity()).toMatchObject([
      { action: 'target.set', target: 'VirtualDevice', args: {}, result: 'ok' }
    ])
  })

  test('setTarget and rename refuse an unknown device', async () => {
    const { devices } = setup(stickOnly())
    await expect(devices.setTarget('NOPE')).rejects.toMatchObject({ code: 'DEVICE_NOT_FOUND' })
    await expect(devices.rename('NOPE', 'Bedroom stick')).rejects.toMatchObject({
      code: 'DEVICE_NOT_FOUND'
    })
    expect((await activity()).map((e) => e.errorCode)).toEqual([
      'DEVICE_NOT_FOUND',
      'DEVICE_NOT_FOUND'
    ])
  })

  test('get returns one device with its info and writes nothing', async () => {
    const { devices } = setup(stickAndVvd())
    expect(await devices.get('VirtualDevice')).toMatchObject({
      id: 'VirtualDevice',
      info: { architecture: 'aarch64' }
    })
    await expect(devices.get('NOPE')).rejects.toMatchObject({ code: 'DEVICE_NOT_FOUND' })
    await expect(readFile(join(home, 'activity.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
