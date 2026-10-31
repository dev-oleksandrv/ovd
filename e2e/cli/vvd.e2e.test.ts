import type { DevicesSnapshot } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import { ovd } from '../harness/cli.ts'
import { createSandbox } from '../harness/vitest.ts'

describe('ovd vvd', () => {
  test('start returns once the Virtual Device is listed online; stop removes it', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()

    expect((await ovd(sandbox, ['vvd', 'status', '--json'])).json()).toMatchObject({
      vvd: { running: false, status: 'stopped' }
    })

    const start = await ovd(sandbox, ['vvd', 'start', '--json'])
    expect(start.exitCode).toBe(0)
    expect(start.json()).toMatchObject({
      ok: true,
      vvd: { running: true, status: 'online', device: { id: 'VirtualDevice', status: 'online' } }
    })
    const listed = (await ovd(sandbox, ['devices', '--json'])).json<DevicesSnapshot>()
    expect(listed.devices).toContainEqual(
      expect.objectContaining({ id: 'VirtualDevice', status: 'online', vdaSerial: 'emulator-5554' })
    )

    const stop = await ovd(sandbox, ['vvd', 'stop', '--json'])
    expect(stop.exitCode).toBe(0)
    expect(stop.json()).toMatchObject({ vvd: { running: false, status: 'stopped' } })
    expect(sandbox.world().vvd.running).toBe(false)

    expect(sandbox.activity()).toEqual([
      expect.objectContaining({ surface: 'cli', action: 'vvd.start', result: 'ok' }),
      expect.objectContaining({ surface: 'cli', action: 'vvd.stop', result: 'ok' })
    ])
  })

  test('start and stop do nothing when it is already in that state', async () => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()

    const start = await ovd(sandbox, ['vvd', 'start'])
    expect(start.exitCode).toBe(0)
    expect(start.stderr).toContain('Starting the Virtual Device…')
    expect(sandbox.calls()).not.toContain('vega virtual-device start')

    await ovd(sandbox, ['vvd', 'stop'])
    sandbox.clearCalls()
    const again = await ovd(sandbox, ['vvd', 'stop', '--json'])
    expect(again.exitCode).toBe(0)
    expect(sandbox.calls()).not.toContain('vega virtual-device stop')
  })

  test('Developer Mode cannot be turned on while it is stopped', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()

    const run = await ovd(sandbox, ['vvd', 'devmode', 'enable', '--json'])

    expect(run.exitCode).toBe(4)
    expect(run.json()).toMatchObject({
      ok: false,
      error: { code: 'TARGET_OFFLINE', hint: 'Start it with ovd vvd start' }
    })
  })
})
