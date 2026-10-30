import { describe, expect, test, vi } from 'vitest'
import { cli } from '../support/runCli.js'
import { fail, stubPairing, wifiStick } from '../support/sample.js'

describe('ovd pair', () => {
  test('--usb --json prints the paired device', async () => {
    const pairUsb = vi.fn(async () => wifiStick)
    const { stdout, stderr, exitCode } = await cli(['pair', '--usb', '--json'], {
      ovd: stubPairing({ pairUsb })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, device: wifiStick })
    expect(stderr).toBe('Switching the stick to TCP/IP…\n')
    expect(pairUsb).toHaveBeenCalledWith({})
    expect(exitCode).toBe(0)
  })

  test('--usb passes the port and --device', async () => {
    const pairUsb = vi.fn(async () => wifiStick)
    await cli(['pair', '--usb', '--port', '6000', '--device', 'G070000000000001'], {
      ovd: stubPairing({ pairUsb })
    })
    expect(pairUsb).toHaveBeenCalledWith({ device: 'G070000000000001', port: 6000 })
  })

  test('an address connects to it', async () => {
    const pair = vi.fn(async () => wifiStick)
    const { stdout, exitCode } = await cli(['pair', '192.0.2.42'], { ovd: stubPairing({ pair }) })
    expect(pair).toHaveBeenCalledWith('192.0.2.42')
    expect(stdout).toBe('Paired Fire TV stick (192.0.2.42:5555 · Wi-Fi · armv7 · OS 2.0)\n')
    expect(exitCode).toBe(0)
  })

  test.each([
    [['pair']],
    [['pair', '--usb', '192.0.2.42']],
    [['pair', '192.0.2.42', '--port', '6000']]
  ])('%j is a usage error', async (args) => {
    const { stdout, exitCode } = await cli([...args, '--json'], { ovd: stubPairing({}) })
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'INVALID_ADDRESS' } })
    expect(exitCode).toBe(2)
  })

  test.each([
    ['PAIR_REFUSED', 5],
    ['PAIR_TIMEOUT', 5],
    ['DIFFERENT_NETWORK', 5],
    ['INVALID_ADDRESS', 2],
    ['DEVICE_NOT_FOUND', 4],
    ['NO_TARGET', 4]
  ] as const)('%s exits %i', async (code, exit) => {
    const { stdout, exitCode } = await cli(['pair', '--usb', '--json'], {
      ovd: stubPairing({ pairUsb: fail(code) })
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code } })
    expect(exitCode).toBe(exit)
  })
})

describe('ovd connect', () => {
  test('--json prints the device', async () => {
    const connect = vi.fn(async () => wifiStick)
    const { stdout, exitCode } = await cli(['connect', '192.0.2.42:5555', '--json'], {
      ovd: stubPairing({ connect })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, device: wifiStick })
    expect(connect).toHaveBeenCalledWith('192.0.2.42:5555')
    expect(exitCode).toBe(0)
  })

  test('a stick that does not answer exits 5', async () => {
    const { exitCode } = await cli(['connect', '192.0.2.42:5555', '--json'], {
      ovd: stubPairing({ connect: fail('PAIR_TIMEOUT') })
    })
    expect(exitCode).toBe(5)
  })
})

describe('ovd forget', () => {
  test('--json prints the ID', async () => {
    const forget = vi.fn(async () => ({ id: '192.0.2.42:5555' }))
    const { stdout, exitCode } = await cli(['forget', '192.0.2.42:5555', '--json'], {
      ovd: stubPairing({ forget })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, id: '192.0.2.42:5555' })
    expect(exitCode).toBe(0)
  })

  test('human output says how to get back to USB', async () => {
    const { stdout } = await cli(['forget', '192.0.2.42:5555'], {
      ovd: stubPairing({ forget: async () => ({ id: '192.0.2.42:5555' }) })
    })
    expect(stdout).toContain('vega exec vda -s 192.0.2.42:5555 usb')
  })

  test('an unknown device exits 4', async () => {
    const { exitCode } = await cli(['forget', '192.0.2.42:5555', '--json'], {
      ovd: stubPairing({ forget: fail('DEVICE_NOT_FOUND') })
    })
    expect(exitCode).toBe(4)
  })
})
