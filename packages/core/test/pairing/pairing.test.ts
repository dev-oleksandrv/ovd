import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  createActivityLog,
  createDevices,
  createPairing,
  createSdkLocator,
  createStateStore,
  OvdError,
  type ActivityEntry,
  type HostNetwork,
  type HostState
} from '../../src/index.js'
import { FakeRunner } from '../support/fakeRunner.js'
import { fixture } from '../support/fixtures.js'

const SERIAL = 'G070000000000001'
const WIFI = '192.0.2.42:5555'
const VDA = 'vega exec vda devices -l'
const STATUS = 'vega virtual-device status'
const FIB = `vega exec vda -s ${SERIAL} shell cat /proc/net/fib_trie`
const TCPIP = `vega exec vda -s ${SERIAL} tcpip 5555`
const CONNECT = `vega exec vda connect ${WIFI}`
const DISCONNECT = `vega exec vda disconnect ${WIFI}`

const out = (path: string) => ({ stdout: fixture(`0.24/${path}`) })
const err = (path: string, exitCode: number) => ({ stderr: fixture(`0.24/${path}`), exitCode })

const lists = {
  usb: out('vda-devices/stick-usb.txt'),
  none: out('vda-devices/none.txt'),
  wifi: out('vda-devices/stick-wifi.txt'),
  wifiOffline: out('vda-devices/stick-wifi-offline.txt')
}
const connect = {
  ok: out('vda-connect/connected.txt'),
  refused: out('vda-connect/refused.txt'),
  timedOut: out('vda-connect/timed-out.txt')
}

// The host is on 198.51.100.0/24 unless a test puts it on the stick's network.
const elsewhere: HostNetwork[] = [{ address: '198.51.100.7', cidr: '198.51.100.7/24' }]
const sameNetwork: HostNetwork[] = [{ address: '192.0.2.7', cidr: '192.0.2.7/24' }]

let home: string

beforeEach(async () => {
  home = join(await mkdtemp(join(tmpdir(), 'ovd-pairing-')), 'ovd')
})

function setup(
  script: ConstructorParameters<typeof FakeRunner>[0],
  opts: { networks?: HostNetwork[]; state?: Partial<HostState> } = {}
) {
  const runner = new FakeRunner({
    [STATUS]: out('vega-virtual-device-status/stopped.json'),
    [`vega device info --device ${SERIAL}`]: out('vega-device-info/stick-usb.json'),
    [`vega device info --device ${WIFI}`]: out('vega-device-info/stick-wifi.json'),
    ...script
  })
  const sdk = createSdkLocator(async () => ({
    vegaPath: '/sdk/vega',
    cli: 'manager',
    sdkVersion: '0.24.12112',
    cliVersion: '1.4.5'
  }))
  const state = createStateStore(home)
  const activity = createActivityLog({ home, surface: 'cli' })
  const devices = createDevices({ runner, sdk, state, activity, env: {} })
  const sleeps: number[] = []
  const pairing = createPairing({
    runner,
    sdk,
    devices,
    state,
    activity,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    hostNetworks: () => opts.networks ?? sameNetwork
  })
  const seed = opts.state
  const ready = seed
    ? state.update((s) => ({ ...s, ...seed })).then(() => undefined)
    : Promise.resolve()
  return { pairing, devices, runner, state, sleeps, ready }
}

async function activity(): Promise<ActivityEntry[]> {
  const text = await readFile(join(home, 'activity.jsonl'), 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ActivityEntry)
}

describe('pairUsb', () => {
  test('reads the IP over USB, switches to TCP/IP, connects and remembers the serial', async () => {
    const { pairing, runner, state, ready } = setup(
      {
        [VDA]: [lists.usb, lists.none, lists.wifi],
        [FIB]: out('vda-shell-fib-trie/stick.txt'),
        [TCPIP]: out('vda-tcpip/restarting.txt'),
        [CONNECT]: connect.ok
      },
      { state: { target: SERIAL } }
    )
    await ready

    const device = await pairing.pairUsb()

    expect(device).toMatchObject({ id: WIFI, connection: 'wifi', status: 'online', saved: true })
    expect(device.serial).toBe(SERIAL)
    const order = runner.calls.map((c) => c.display).filter((d) => d !== VDA && d !== STATUS)
    expect(order.indexOf(FIB)).toBeLessThan(order.indexOf(TCPIP))
    expect(order.indexOf(TCPIP)).toBeLessThan(order.indexOf(CONNECT))
    const { state: saved } = await state.read()
    expect(saved.saved).toEqual([expect.objectContaining({ id: WIFI, serial: SERIAL })])
    // Same stick, new ID: it stays the target.
    expect(saved.target).toBe(WIFI)
    expect(await activity()).toEqual([
      expect.objectContaining({ action: 'pair.tcpip', target: SERIAL, result: 'ok' }),
      expect.objectContaining({ action: 'pair.connect', target: WIFI, result: 'ok' })
    ])
  })

  test('retries a connect the restarting stick refuses', async () => {
    const { pairing, runner, sleeps } = setup({
      [VDA]: [lists.usb, lists.wifi],
      [FIB]: out('vda-shell-fib-trie/stick.txt'),
      [TCPIP]: out('vda-tcpip/restarting.txt'),
      [CONNECT]: [connect.refused, connect.refused, connect.ok]
    })
    await expect(pairing.pairUsb()).resolves.toMatchObject({ id: WIFI })
    expect(runner.count(CONNECT)).toBe(3)
    expect(sleeps).toEqual([1000, 1000])
  })

  test('uses the port asked for', async () => {
    const { pairing, runner } = setup({
      [VDA]: [lists.usb, out('vda-devices/none.txt')],
      [FIB]: out('vda-shell-fib-trie/stick.txt'),
      [`vega exec vda -s ${SERIAL} tcpip 6000`]: { stdout: 'restarting in TCP mode port: 6000\n' },
      ['vega exec vda connect 192.0.2.42:6000']: connect.refused
    })
    await expect(pairing.pairUsb({ port: 6000 })).rejects.toMatchObject({ code: 'PAIR_REFUSED' })
    expect(runner.count('vega exec vda connect 192.0.2.42:6000')).toBe(10)
  })

  test('a bad port is refused before anything runs', async () => {
    const { pairing, runner } = setup({})
    await expect(pairing.pairUsb({ port: 80 })).rejects.toMatchObject({ code: 'INVALID_ADDRESS' })
    expect(runner.calls).toEqual([])
  })

  test('no stick on USB', async () => {
    const { pairing } = setup({ [VDA]: lists.none })
    await expect(pairing.pairUsb()).rejects.toMatchObject({ code: 'DEVICE_NOT_FOUND' })
  })

  test('a --device that is not on USB', async () => {
    const { pairing } = setup({ [VDA]: lists.wifi })
    await expect(pairing.pairUsb({ device: WIFI })).rejects.toMatchObject({
      code: 'DEVICE_NOT_FOUND'
    })
  })

  test('a stick on no network is not switched', async () => {
    const { pairing, runner } = setup({
      [VDA]: lists.usb,
      [FIB]: { stdout: 'Main:\n     |-- 127.0.0.1\n        /32 host LOCAL\n' }
    })
    await expect(pairing.pairUsb()).rejects.toMatchObject({ code: 'COMMAND_FAILED' })
    expect(runner.count(TCPIP)).toBe(0)
  })

  test('tcpip failing is logged and stops the pairing', async () => {
    const { pairing, runner } = setup({
      [VDA]: lists.usb,
      [FIB]: out('vda-shell-fib-trie/stick.txt'),
      [TCPIP]: err('vda-tcpip/device-not-found.stderr.txt', 1)
    })
    await expect(pairing.pairUsb()).rejects.toMatchObject({ code: 'COMMAND_FAILED' })
    expect(runner.count(CONNECT)).toBe(0)
    expect(await activity()).toEqual([
      expect.objectContaining({
        action: 'pair.tcpip',
        result: 'error',
        errorCode: 'COMMAND_FAILED'
      })
    ])
  })
})

describe('pair by address', () => {
  test('connects and remembers the device without a serial', async () => {
    const { pairing, state } = setup({ [VDA]: lists.wifi, [CONNECT]: connect.ok })
    const device = await pairing.pair('192.0.2.42')
    expect(device).toMatchObject({ id: WIFI, status: 'online', saved: true })
    expect(device.serial).toBeUndefined()
    const { state: saved } = await state.read()
    expect(saved.saved).toEqual([{ id: WIFI, savedAt: expect.any(String) }])
    expect(await activity()).toEqual([
      expect.objectContaining({ action: 'pair.connect', target: WIFI, result: 'ok' })
    ])
  })

  test('keeps the serial a USB pairing learned', async () => {
    const { pairing, state, ready } = setup(
      { [VDA]: lists.wifi, [CONNECT]: connect.ok },
      { state: { saved: [{ id: WIFI, serial: SERIAL, savedAt: '2026-10-30T00:00:00.000Z' }] } }
    )
    await ready
    await expect(pairing.pair(WIFI)).resolves.toMatchObject({ serial: SERIAL })
    const { state: saved } = await state.read()
    expect(saved.saved).toEqual([expect.objectContaining({ id: WIFI, serial: SERIAL })])
  })

  test.each([
    ['refused', connect.refused, sameNetwork, 'PAIR_REFUSED'],
    ['timed out on the host network', connect.timedOut, sameNetwork, 'PAIR_TIMEOUT'],
    ['timed out on another network', connect.timedOut, elsewhere, 'DIFFERENT_NETWORK'],
    [
      'stopped by OVD',
      new OvdError('COMMAND_FAILED', 'did not finish in time', '', { timedOut: true }),
      elsewhere,
      'DIFFERENT_NETWORK'
    ],
    ['bad address', out('vda-connect/bad-host.txt'), sameNetwork, 'INVALID_ADDRESS']
  ])('%s', async (_name, result, networks, code) => {
    const { pairing, state } = setup({ [VDA]: lists.none, [CONNECT]: result }, { networks })
    await expect(pairing.pair(WIFI)).rejects.toMatchObject({ code })
    const { state: saved } = await state.read()
    expect(saved.saved).toEqual([])
    expect(await activity()).toEqual([
      expect.objectContaining({ action: 'pair.connect', result: 'error', errorCode: code })
    ])
  })

  test('names the host network in the different-network error', async () => {
    const { pairing } = setup({ [CONNECT]: connect.timedOut }, { networks: elsewhere })
    await expect(pairing.pair(WIFI)).rejects.toThrow(
      'This computer is on 198.51.100.0/24, but 192.0.2.42 is on another network'
    )
  })

  test('stops vda connect after 20 s', async () => {
    const { pairing, runner } = setup({ [VDA]: lists.wifi, [CONNECT]: connect.ok })
    await pairing.pair(WIFI)
    expect(runner.calls.find((c) => c.display === CONNECT)?.timeoutMs).toBe(20_000)
  })

  test('a bad address never reaches VDA', async () => {
    const { pairing, runner } = setup({})
    await expect(pairing.pair('192.0.2.42:80')).rejects.toMatchObject({
      code: 'INVALID_ADDRESS'
    })
    expect(runner.calls).toEqual([])
  })

  test('connected but never listed online', async () => {
    const { pairing, sleeps } = setup({ [VDA]: lists.wifiOffline, [CONNECT]: connect.ok })
    await expect(pairing.pair(WIFI)).rejects.toMatchObject({ code: 'PAIR_TIMEOUT' })
    expect(sleeps).toHaveLength(10)
  })
})

describe('connect', () => {
  test('logs as connect', async () => {
    const { pairing } = setup({ [VDA]: lists.wifi, [CONNECT]: connect.ok })
    await pairing.connect(WIFI)
    expect(await activity()).toEqual([
      expect.objectContaining({ action: 'connect', target: WIFI, result: 'ok' })
    ])
  })
})

describe('forget', () => {
  const saved = { saved: [{ id: WIFI, savedAt: '2026-10-30T00:00:00.000Z' }] }

  test('disconnects and drops the device, its name and the target', async () => {
    const { pairing, state, ready } = setup(
      { [DISCONNECT]: out('vda-disconnect/disconnected.txt') },
      { state: { ...saved, target: WIFI, names: { [WIFI]: 'Bedroom stick' } } }
    )
    await ready
    await expect(pairing.forget(WIFI)).resolves.toEqual({ id: WIFI })
    const { state: after } = await state.read()
    expect(after).toEqual({ version: 1, names: {}, saved: [] })
    expect(await activity()).toEqual([
      expect.objectContaining({ action: 'forget', target: WIFI, result: 'ok' })
    ])
  })

  test('keeps a name stored under the serial', async () => {
    const { pairing, state, ready } = setup(
      { [DISCONNECT]: err('vda-disconnect/no-such-device.stderr.txt', 1) },
      {
        state: {
          saved: [{ id: WIFI, serial: SERIAL, savedAt: '2026-10-30T00:00:00.000Z' }],
          names: { [SERIAL]: 'Bedroom stick' },
          target: SERIAL
        }
      }
    )
    await ready
    await pairing.forget(WIFI)
    const { state: after } = await state.read()
    expect(after).toEqual({
      version: 1,
      target: SERIAL,
      names: { [SERIAL]: 'Bedroom stick' },
      saved: []
    })
  })

  test('an unknown device', async () => {
    const { pairing } = setup({ [DISCONNECT]: err('vda-disconnect/no-such-device.stderr.txt', 1) })
    await expect(pairing.forget(WIFI)).rejects.toMatchObject({ code: 'DEVICE_NOT_FOUND' })
  })

  test('a connected device that was never saved is disconnected', async () => {
    const { pairing } = setup({ [DISCONNECT]: out('vda-disconnect/disconnected.txt') })
    await expect(pairing.forget(WIFI)).resolves.toEqual({ id: WIFI })
  })
})

describe('reconnectSaved', () => {
  const saved = { saved: [{ id: WIFI, savedAt: '2026-10-30T00:00:00.000Z' }] }

  test('connects a saved device VDA has lost, without logging it', async () => {
    const { pairing, runner, ready } = setup(
      { [VDA]: lists.none, [CONNECT]: connect.timedOut },
      { state: saved }
    )
    await ready
    await pairing.reconnectSaved()
    expect(runner.calls.find((c) => c.display === CONNECT)?.timeoutMs).toBe(5_000)
    expect(await activity()).toEqual([])
  })

  test('leaves an offline device VDA still tracks alone', async () => {
    const { pairing, runner, ready } = setup({ [VDA]: lists.wifiOffline }, { state: saved })
    await ready
    await pairing.reconnectSaved()
    expect(runner.count(CONNECT)).toBe(0)
  })
})

describe('saved devices in the list', () => {
  test('an offline saved stick keeps its serial and name', async () => {
    const { devices, ready } = setup(
      { [VDA]: lists.wifiOffline },
      {
        state: {
          saved: [{ id: WIFI, serial: SERIAL, savedAt: '2026-10-30T00:00:00.000Z' }],
          names: { [SERIAL]: 'Bedroom stick' }
        }
      }
    )
    await ready
    const { devices: list } = await devices.list()
    expect(list.find((d) => d.id === WIFI)).toMatchObject({
      status: 'offline',
      serial: SERIAL,
      name: 'Bedroom stick',
      saved: true
    })
  })
})
