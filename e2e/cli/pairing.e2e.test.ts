import type { Device, DevicesSnapshot } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import { ovd } from '../harness/cli.ts'
import { createSandbox, type Sandbox } from '../harness/vitest.ts'
import { STICK_ADDRESS, STICK_IP, STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'

async function device(sandbox: Sandbox, id: string): Promise<Device | undefined> {
  const snapshot = (await ovd(sandbox, ['devices', '--json'])).json<DevicesSnapshot>()
  return snapshot.devices.find((d) => d.id === id)
}

// A stick switched to TCP/IP on the TV (Connection Mode), so there is no USB route.
function tvTcpip(): Partial<Parameters<typeof createSandbox>[0]> {
  return { stick: usbStick({ mode: 'tcpip', usbCable: false }) }
}

describe('ovd pair --usb', () => {
  test('switches the stick on USB to TCP/IP and connects to it over Wi‑Fi', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    sandbox.installSdk()
    await ovd(sandbox, ['device', 'rename', STICK_SERIAL, 'Living room stick'])
    await ovd(sandbox, ['target', 'set', STICK_SERIAL])
    sandbox.clearCalls()

    const run = await ovd(sandbox, ['pair', '--usb', '--json'])

    expect(run.exitCode).toBe(0)
    expect(run.json()).toMatchObject({
      ok: true,
      device: {
        id: STICK_ADDRESS,
        connection: 'wifi',
        ip: STICK_IP,
        status: 'online',
        serial: STICK_SERIAL,
        saved: true,
        // Names are kept per serial, so the stick keeps its name over Wi‑Fi.
        name: 'Living room stick'
      }
    })
    // The IP is read while the stick is still on USB, before the switch.
    const pairing = sandbox
      .calls()
      .filter((c) => !/--version|devices -l|virtual-device status|device info/.test(c))
    expect(pairing).toEqual([
      `vega exec vda -s ${STICK_SERIAL} shell cat /proc/net/fib_trie`,
      `vega exec vda -s ${STICK_SERIAL} tcpip 5555`,
      `vega exec vda connect ${STICK_ADDRESS}`
    ])
    // The target follows the stick to its Wi‑Fi ID.
    expect(sandbox.hostState()).toMatchObject({
      target: STICK_ADDRESS,
      saved: [{ id: STICK_ADDRESS, serial: STICK_SERIAL }]
    })
    expect(await device(sandbox, STICK_SERIAL)).toBeUndefined()
  })

  test('with no stick on USB it says how to get one there', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()

    const run = await ovd(sandbox, ['pair', '--usb', '--json'])

    expect(run.exitCode).toBe(4)
    expect(run.json()).toMatchObject({
      ok: false,
      error: { code: 'DEVICE_NOT_FOUND', message: 'No stick is plugged in over USB' }
    })
  })

  test('a port at or below 1024 is refused before VDA is asked', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['pair', '--usb', '--port', '80', '--json'])

    expect(run.exitCode).toBe(2)
    expect(run.json()).toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_ADDRESS',
        hint: 'Port must be a number above 1024 (the default is 5555)'
      }
    })
    expect(sandbox.calls().filter((c) => c.includes('tcpip'))).toEqual([])
  })
})

describe('ovd pair <address>', () => {
  test('connects to a stick in TCP/IP mode and remembers it', async () => {
    const sandbox = createSandbox(tvTcpip())
    sandbox.installSdk()

    const run = await ovd(sandbox, ['pair', STICK_IP])

    expect(run.exitCode).toBe(0)
    expect(run.stderr).toContain(`Connecting to ${STICK_IP}…`)
    expect(run.stdout).toBe(`Paired Fire TV stick (${STICK_ADDRESS} · Wi-Fi · armv7 · OS 2.0)\n`)
    // Over Wi‑Fi no command reads the serial, so none is saved.
    expect(sandbox.hostState()).toMatchObject({ saved: [{ id: STICK_ADDRESS }] })
    expect(sandbox.hostState()).not.toMatchObject({ saved: [{ serial: expect.anything() }] })
  })

  test.each([
    [
      'refused on another port',
      `${STICK_IP}:5556`,
      'PAIR_REFUSED',
      `${STICK_IP}:5556 refused the connection`
    ],
    // 192.0.2.1 is outside the host's networks, so a timeout means a different network.
    [
      'unreachable on another network',
      '192.0.2.1:5555',
      'DIFFERENT_NETWORK',
      'is on another network'
    ]
  ])('%s: exits 5 and remembers nothing', async (_case, address, code, message) => {
    const sandbox = createSandbox(tvTcpip())
    sandbox.installSdk()

    const run = await ovd(sandbox, ['pair', address, '--json'])

    expect(run.exitCode).toBe(5)
    expect(run.json()).toMatchObject({
      ok: false,
      error: { code, message: expect.stringContaining(message) }
    })
    expect(sandbox.hostState()).toBeNull()
  })

  test('an address that is not an IP is a usage error', async () => {
    const sandbox = createSandbox(tvTcpip())
    sandbox.installSdk()

    const run = await ovd(sandbox, ['pair', '192.0.2.300', '--json'])

    expect(run.exitCode).toBe(2)
    expect(run.json()).toMatchObject({ ok: false, error: { code: 'INVALID_ADDRESS' } })
    expect(sandbox.calls().filter((c) => c.includes('connect'))).toEqual([])
  })

  test('--usb and an address together are a usage error', async () => {
    const sandbox = createSandbox(tvTcpip())
    sandbox.installSdk()

    const run = await ovd(sandbox, ['pair', '--usb', STICK_IP, '--json'])

    expect(run.exitCode).toBe(2)
    expect(run.json()).toMatchObject({ ok: false, error: { code: 'INVALID_ADDRESS' } })
  })
})

describe('saved Wi‑Fi devices', () => {
  test('a saved stick stays listed offline and reconnects without retyping its address', async () => {
    const sandbox = createSandbox(tvTcpip())
    sandbox.installSdk()
    await ovd(sandbox, ['pair', STICK_ADDRESS])

    // The host restarts: VDA forgets its connections.
    sandbox.update((w) => (w.vdaConnected = []))
    expect(await device(sandbox, STICK_ADDRESS)).toMatchObject({ status: 'offline', saved: true })
    expect((await ovd(sandbox, ['devices'])).stdout).toMatch(
      new RegExp(`${STICK_ADDRESS}.*offline`)
    )

    const connect = await ovd(sandbox, ['connect', STICK_ADDRESS, '--json'])
    expect(connect.exitCode).toBe(0)
    expect(connect.json()).toMatchObject({ device: { id: STICK_ADDRESS, status: 'online' } })
  })

  test('a powered-off stick is listed offline while VDA holds the connection', async () => {
    const sandbox = createSandbox(tvTcpip())
    sandbox.installSdk()
    await ovd(sandbox, ['pair', STICK_ADDRESS])

    sandbox.update((w) => {
      if (w.stick) w.stick.powered = false
    })

    expect(await device(sandbox, STICK_ADDRESS)).toMatchObject({
      status: 'offline',
      vdaSerial: STICK_ADDRESS,
      saved: true
    })
  })

  test('forgetting a stick paired over USB switches it back to USB', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    sandbox.installSdk()
    await ovd(sandbox, ['target', 'set', STICK_SERIAL])
    await ovd(sandbox, ['pair', '--usb'])
    sandbox.clearCalls()

    const run = await ovd(sandbox, ['forget', STICK_ADDRESS, '--json'])

    expect(run.exitCode).toBe(0)
    expect(run.json()).toEqual({ ok: true, id: STICK_ADDRESS, switchedToUsb: true })
    expect(sandbox.calls()).toEqual(
      expect.arrayContaining([
        `vega exec vda -s ${STICK_ADDRESS} usb`,
        `vega exec vda disconnect ${STICK_ADDRESS}`
      ])
    )
    expect(await device(sandbox, STICK_SERIAL)).toMatchObject({
      connection: 'usb',
      status: 'online',
      isTarget: true
    })
    expect(await device(sandbox, STICK_ADDRESS)).toBeUndefined()
    expect(sandbox.hostState()).toMatchObject({ target: STICK_SERIAL, saved: [] })
  })

  test('forgetting a stick paired on the TV leaves it in TCP/IP mode and says how to switch back', async () => {
    const sandbox = createSandbox(tvTcpip())
    sandbox.installSdk()
    await ovd(sandbox, ['pair', STICK_ADDRESS])

    const run = await ovd(sandbox, ['forget', STICK_ADDRESS])

    expect(run.exitCode).toBe(0)
    expect(run.stdout).toBe(
      `Forgot ${STICK_ADDRESS}\nIt stays in TCP/IP mode. To use it over USB, on the TV: ` +
        'Settings → My Fire TV → Developer Options → Connection Mode → USB\n'
    )
    expect(sandbox.calls()).not.toContain(`vega exec vda -s ${STICK_ADDRESS} usb`)
    expect(await device(sandbox, STICK_ADDRESS)).toBeUndefined()
  })

  test('forgetting a device that was never saved exits 4', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()

    const run = await ovd(sandbox, ['forget', STICK_ADDRESS, '--json'])

    expect(run.exitCode).toBe(4)
    expect(run.json()).toMatchObject({ ok: false, error: { code: 'DEVICE_NOT_FOUND' } })
  })
})
