import type { DevicesSnapshot } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import { ovd } from '../harness/cli.ts'
import { createSandbox } from '../harness/sandbox.ts'
import { STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'

async function listed(sandbox: ReturnType<typeof createSandbox>): Promise<string[]> {
  const snapshot = (await ovd(sandbox, ['devices', '--json'])).json<DevicesSnapshot>()
  return snapshot.devices.map((d) => d.id)
}

describe('ovd setup-stick', () => {
  test('a new stick goes from not listed to listed on USB', async () => {
    const sandbox = createSandbox({
      stick: usbStick({ developerMode: false }),
      account: 'signed-out',
      tvCode: 'ABC123'
    })
    sandbox.installSdk()
    expect(await listed(sandbox)).not.toContain(STICK_SERIAL)

    // Typed the way the SDK's own help writes codes; OVD normalizes it.
    const run = await ovd(sandbox, ['setup-stick', '--code', 'abc-123', '--json'])

    expect(run.exitCode).toBe(0)
    const lines = run.jsonLines()
    expect(lines.slice(0, -1)).toEqual([
      {
        step: 'login',
        status: 'pending',
        verificationUri: 'https://amazon.com/us/code?cbl-code=ABC123',
        userCode: 'ABC123'
      },
      { step: 'login', status: 'done' },
      { step: 'enable', status: 'done' },
      { step: 'connect', status: 'waiting' }
    ])
    expect(lines.at(-1)).toMatchObject({
      ok: true,
      device: {
        id: STICK_SERIAL,
        connection: 'usb',
        status: 'online',
        info: { architecture: 'armv7' }
      }
    })
    expect(sandbox.calls()).toContain('vega devmode enable-device --code ABC123 --json')
    expect(await listed(sandbox)).toContain(STICK_SERIAL)
    expect(sandbox.activity()).toContainEqual(
      expect.objectContaining({ action: 'devmode.enable', result: 'ok' })
    )
  })

  test('the human output shows the sign-in link and ends with the stick', async () => {
    const sandbox = createSandbox({
      stick: usbStick({ developerMode: false }),
      account: 'signed-out'
    })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['setup-stick', '--code', 'ABC123'])

    expect(run.exitCode).toBe(0)
    expect(run.stderr).toContain(
      'Open https://amazon.com/us/code?cbl-code=ABC123 in your browser and enter the code ABC123'
    )
    expect(run.stdout).toBe(
      `Fire TV stick · ${STICK_SERIAL} · USB · armv7 · OS 2.0 — now in Devices\n`
    )
  })

  test('a wrong code is rejected and a fresh one then works', async () => {
    const sandbox = createSandbox({ stick: usbStick({ developerMode: false }), tvCode: 'XYZ789' })
    sandbox.installSdk()

    const wrong = await ovd(sandbox, ['setup-stick', '--code', 'ABC123', '--json'])
    expect(wrong.exitCode).toBe(5)
    expect(wrong.jsonLines().at(-1)).toMatchObject({
      ok: false,
      error: {
        code: 'CODE_REJECTED',
        hint: 'On the TV, open Developer Mode again to get a fresh code'
      }
    })
    expect(await listed(sandbox)).not.toContain(STICK_SERIAL)

    const retry = await ovd(sandbox, ['setup-stick', '--code', 'XYZ789', '--json'])
    expect(retry.exitCode).toBe(0)
    expect(await listed(sandbox)).toContain(STICK_SERIAL)
  })

  test('an expired sign-in stops before anything changes on the stick', async () => {
    const sandbox = createSandbox({ stick: usbStick({ developerMode: false }), account: 'expired' })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['setup-stick', '--code', 'ABC123', '--json'])

    expect(run.exitCode).toBe(5)
    expect(run.jsonLines().at(-1)).toMatchObject({ ok: false, error: { code: 'NOT_SIGNED_IN' } })
    expect(sandbox.world().stick?.developerMode).toBe(false)
  })

  test('a malformed code fails before the sign-in', async () => {
    const sandbox = createSandbox({
      stick: usbStick({ developerMode: false }),
      account: 'signed-out'
    })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['setup-stick', '--code', '12', '--json'])

    expect(run.exitCode).toBe(2)
    expect(run.json()).toMatchObject({ ok: false, error: { code: 'INVALID_CODE' } })
    expect(sandbox.calls()).not.toContain('vega devmode login --json')
  })

  test('without a terminal the code must come from --code', async () => {
    const sandbox = createSandbox({ stick: usbStick({ developerMode: false }) })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['setup-stick', '--json'])

    expect(run.exitCode).toBe(2)
    expect(run.json()).toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_CODE',
        hint: 'Pass it with --code <code>, or run ovd setup-stick in a terminal'
      }
    })
  })

  test('--wifi stops once Developer Mode is on and points to pairing', async () => {
    const sandbox = createSandbox({ stick: usbStick({ developerMode: false }) })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['setup-stick', '--code', 'ABC123', '--wifi'])

    expect(run.exitCode).toBe(0)
    expect(run.stdout).toBe(
      'Developer Mode is on. Pair the stick over Wi-Fi: ovd pair --usb, or ovd pair <ip>[:port]\n'
    )
    expect(sandbox.world().stick?.developerMode).toBe(true)
  })

  test('the SDK-bundled vega cannot set up a stick', async () => {
    const sandbox = createSandbox({ stick: usbStick({ developerMode: false }) })
    sandbox.installSdk('bundled')

    const run = await ovd(sandbox, ['setup-stick', '--code', 'ABC123', '--json'])

    expect(run.exitCode).toBe(3)
    expect(run.json()).toMatchObject({ ok: false, error: { code: 'SDK_MANAGER_MISSING' } })
  })
})
