import type { Device, DevicesSnapshot } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import { ovd } from '../harness/cli.ts'
import { createSandbox } from '../harness/vitest.ts'
import { STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'

type Listed = DevicesSnapshot & { ok: true }

function find(snapshot: Listed, id: string): Device | undefined {
  return snapshot.devices.find((d) => d.id === id)
}

describe('ovd devices', () => {
  test('a stick without Developer Mode is not listed, and the CLI says why', async () => {
    const sandbox = createSandbox({ stick: usbStick({ developerMode: false }) })
    sandbox.installSdk()

    const json = await ovd(sandbox, ['devices', '--json'])
    expect(json.exitCode).toBe(0)
    expect(json.json<Listed>()).toMatchObject({
      target: null,
      devices: [
        { id: 'VirtualDevice', kind: 'vvd', status: 'stopped', name: 'Vega Virtual Device' }
      ]
    })

    const human = await ovd(sandbox, ['devices'])
    expect(human.stderr).toContain('A Fire TV stick shows up here only after Developer Mode is on.')
  })

  test('lists a USB stick and the running Virtual Device with what each reports', async () => {
    const sandbox = createSandbox({
      stick: usbStick(),
      vvd: { running: true, developerMode: true }
    })
    sandbox.installSdk()

    const snapshot = (await ovd(sandbox, ['devices', '--json'])).json<Listed>()

    expect(find(snapshot, STICK_SERIAL)).toMatchObject({
      name: 'Fire TV stick',
      kind: 'stick',
      connection: 'usb',
      status: 'online',
      serial: STICK_SERIAL,
      info: { os: 'OS 2.0', build: 'TV Ship/529', architecture: 'armv7', developerMode: true }
    })
    expect(find(snapshot, 'VirtualDevice')).toMatchObject({
      kind: 'vvd',
      connection: 'local',
      status: 'online',
      vdaSerial: 'emulator-5554',
      info: { architecture: 'aarch64', simulated: true }
    })
    // Two online devices: none is picked as the target on its own.
    expect(snapshot.target).toBeNull()
  })

  test('an unplugged stick leaves the list', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    sandbox.installSdk()
    expect(
      find((await ovd(sandbox, ['devices', '--json'])).json<Listed>(), STICK_SERIAL)
    ).toBeDefined()

    sandbox.update((w) => {
      if (w.stick) w.stick.usbCable = false
    })

    expect(
      find((await ovd(sandbox, ['devices', '--json'])).json<Listed>(), STICK_SERIAL)
    ).toBeUndefined()
  })

  test('without an SDK it fails with exit code 3 and the install hint', async () => {
    const sandbox = createSandbox()

    const run = await ovd(sandbox, ['devices', '--json'])

    expect(run.exitCode).toBe(3)
    expect(run.json()).toMatchObject({ ok: false, error: { code: 'SDK_NOT_FOUND' } })
  })
})

describe('ovd device', () => {
  test('info shows what the device reports; an unknown ID exits 4', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    sandbox.installSdk()

    const info = await ovd(sandbox, ['device', 'info', STICK_SERIAL, '--json'])
    expect(info.exitCode).toBe(0)
    expect(info.json()).toMatchObject({
      ok: true,
      device: { id: STICK_SERIAL, info: { profile: 'tv', product: 'callie' } }
    })
    expect(sandbox.calls()).toContain(`vega device info --device ${STICK_SERIAL}`)

    const unknown = await ovd(sandbox, ['device', 'info', 'G079999999999999', '--json'])
    expect(unknown.exitCode).toBe(4)
    expect(unknown.json()).toMatchObject({ ok: false, error: { code: 'DEVICE_NOT_FOUND' } })
  })

  test('a name given to a stick is kept by every later command', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    sandbox.installSdk()

    const rename = await ovd(sandbox, ['device', 'rename', STICK_SERIAL, 'Living room stick'])
    expect(rename.exitCode).toBe(0)
    expect(rename.stdout).toBe(`Renamed ${STICK_SERIAL} to Living room stick\n`)

    const snapshot = (await ovd(sandbox, ['devices', '--json'])).json<Listed>()
    expect(find(snapshot, STICK_SERIAL)?.name).toBe('Living room stick')
    expect(sandbox.activity()).toContainEqual(
      expect.objectContaining({
        surface: 'cli',
        action: 'device.rename',
        target: STICK_SERIAL,
        result: 'ok'
      })
    )
  })

  test('an empty name is a usage error and changes nothing', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['device', 'rename', STICK_SERIAL, '  ', '--json'])

    expect(run.exitCode).toBe(2)
    expect(run.json()).toMatchObject({ ok: false, error: { code: 'INVALID_NAME' } })
    expect(sandbox.hostState()).toBeNull()
  })
})

describe('ovd target', () => {
  test('the only online device is the target until another one is set', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    sandbox.installSdk()

    expect((await ovd(sandbox, ['target', '--json'])).json()).toMatchObject({
      target: { id: STICK_SERIAL },
      source: 'only-online'
    })

    // A second device comes online: the target is no longer obvious.
    await ovd(sandbox, ['vvd', 'start'])
    const none = await ovd(sandbox, ['target'])
    expect(none.stdout).toBe('No target.\n')
    expect(none.stderr).toContain('Set one with: ovd target set <id>')

    const set = await ovd(sandbox, ['target', 'set', 'VirtualDevice', '--json'])
    expect(set.json()).toMatchObject({ ok: true, target: { id: 'VirtualDevice', isTarget: true } })
    expect((await ovd(sandbox, ['target', '--json'])).json()).toMatchObject({
      target: { id: 'VirtualDevice' },
      source: 'remembered'
    })
    const snapshot = (await ovd(sandbox, ['devices', '--json'])).json<Listed>()
    expect(snapshot.target).toBe('VirtualDevice')
    expect(find(snapshot, STICK_SERIAL)?.isTarget).toBe(false)
  })

  test('a remembered target that goes away stays the target, offline', async () => {
    const sandbox = createSandbox({
      stick: usbStick(),
      vvd: { running: true, developerMode: true }
    })
    sandbox.installSdk()
    await ovd(sandbox, ['target', 'set', STICK_SERIAL])

    sandbox.update((w) => {
      if (w.stick) w.stick.usbCable = false
    })

    const snapshot = (await ovd(sandbox, ['devices', '--json'])).json<Listed>()
    expect(snapshot.target).toBe(STICK_SERIAL)
    expect(find(snapshot, STICK_SERIAL)).toMatchObject({ status: 'offline', isTarget: true })
  })

  test('VEGA_SERIAL and --device override the remembered target', async () => {
    const sandbox = createSandbox({
      stick: usbStick(),
      vvd: { running: true, developerMode: true }
    })
    sandbox.installSdk()
    await ovd(sandbox, ['target', 'set', 'VirtualDevice'])

    const fromEnv = await ovd(sandbox, ['target', '--json'], { env: { VEGA_SERIAL: STICK_SERIAL } })
    expect(fromEnv.json()).toMatchObject({ target: { id: STICK_SERIAL }, source: 'env' })

    const fromFlag = await ovd(sandbox, ['target', '--device', STICK_SERIAL, '--json'])
    expect(fromFlag.json()).toMatchObject({ target: { id: STICK_SERIAL }, source: 'flag' })

    const unknown = await ovd(sandbox, ['target', '--device', 'G079999999999999', '--json'])
    expect(unknown.exitCode).toBe(4)
    expect(unknown.json()).toMatchObject({ ok: false, error: { code: 'DEVICE_NOT_FOUND' } })

    // Overrides are per command; the remembered target is unchanged.
    expect(sandbox.hostState()).toMatchObject({ target: 'VirtualDevice' })
  })

  test('setting an unknown device as the target exits 4 and remembers nothing', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()

    const run = await ovd(sandbox, ['target', 'set', 'G079999999999999', '--json'])

    expect(run.exitCode).toBe(4)
    expect(sandbox.hostState()).toBeNull()
    expect(sandbox.activity()).toContainEqual(
      expect.objectContaining({
        action: 'target.set',
        result: 'error',
        errorCode: 'DEVICE_NOT_FOUND'
      })
    )
  })
})
