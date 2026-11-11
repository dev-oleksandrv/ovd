import type { Check, DevicesSnapshot, DoctorReport, VvdStartResult } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import { ovd } from '../harness/cli.ts'
import { createSandbox, type Sandbox } from '../harness/vitest.ts'

async function grpcRow(sandbox: Sandbox): Promise<Check | undefined> {
  const run = await ovd(sandbox, ['doctor', '--json'])
  return run.json<DoctorReport>().checks.find((c) => c.id === 'grpc')
}

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
      expect.objectContaining({ surface: 'cli', action: 'vvd.grpc.enable', result: 'ok' }),
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

  describe('emulator gRPC', () => {
    test('start turns it on, doctor probes it with getVmState; stop turns it off', async () => {
      const sandbox = createSandbox()
      sandbox.installSdk()
      const port = sandbox.env.OVD_EMULATOR_GRPC_PORT

      const start = await ovd(sandbox, ['vvd', 'start'])
      expect(start.exitCode).toBe(0)
      expect(start.stdout).toContain(`Emulator gRPC on · :${port}\n`)
      expect(start.stderr).not.toContain('Emulator gRPC')
      expect(sandbox.activity().at(-1)).toMatchObject({
        action: 'vvd.grpc.enable',
        target: 'VirtualDevice',
        args: { port },
        result: 'ok'
      })
      expect(sandbox.grpcCalls()).toEqual([])

      expect(await grpcRow(sandbox)).toEqual({
        id: 'grpc',
        name: 'Emulator gRPC',
        status: 'ok',
        detail: `On · :${port}`
      })
      expect(sandbox.grpcCalls()).toEqual([{ method: 'getVmState' }])

      await ovd(sandbox, ['vvd', 'stop'])
      expect(await grpcRow(sandbox)).toMatchObject({ status: 'info', detail: 'Not running' })
    })

    test('without the console token: the start works, gRPC failed, doctor warns', async () => {
      const sandbox = createSandbox({ consoleToken: 'missing' })
      sandbox.installSdk()

      const start = await ovd(sandbox, ['vvd', 'start', '--json'])
      expect(start.exitCode).toBe(0)
      expect(start.json<{ ok: true; vvd: VvdStartResult }>().vvd).toMatchObject({
        status: 'online',
        grpc: {
          status: 'failed',
          error: {
            code: 'VVD_GRPC_FAILED',
            message: '~/.emulator_console_auth_token is missing or unreadable'
          }
        }
      })
      expect(sandbox.activity().map((a) => [a.action, a.result, a.errorCode])).toEqual([
        ['vvd.start', 'ok', undefined],
        ['vvd.grpc.enable', 'error', 'VVD_GRPC_FAILED']
      ])

      expect(await grpcRow(sandbox)).toMatchObject({
        status: 'warn',
        detail: 'Couldn’t enable',
        hint: 'Turn it on with ovd vvd start',
        fix: 'enable-vvd-grpc'
      })
      expect(sandbox.grpcCalls()).toEqual([])
    })

    test('human output warns on stderr and still exits 0', async () => {
      const sandbox = createSandbox({ consoleToken: 'missing' })
      sandbox.installSdk()

      const start = await ovd(sandbox, ['vvd', 'start'])
      expect(start.exitCode).toBe(0)
      expect(start.stdout).toBe('Virtual Device started (VirtualDevice · aarch64)\n')
      expect(start.stderr).toContain(
        '! Emulator gRPC couldn’t be turned on: ~/.emulator_console_auth_token is missing or unreadable\n'
      )
    })

    test('a running Virtual Device with gRPC off: doctor warns, ovd vvd start turns it on', async () => {
      const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
      sandbox.installSdk()
      const port = sandbox.env.OVD_EMULATOR_GRPC_PORT

      expect(await grpcRow(sandbox)).toMatchObject({ status: 'warn', detail: 'Couldn’t enable' })

      const start = await ovd(sandbox, ['vvd', 'start', '--json'])
      expect(start.json<{ vvd: VvdStartResult }>().vvd.grpc).toEqual({
        status: 'on',
        port: Number(port)
      })
      // Already running: nothing was started, gRPC was turned on all the same.
      expect(sandbox.calls()).not.toContain('vega virtual-device start')

      expect(await grpcRow(sandbox)).toMatchObject({ status: 'ok', detail: `On · :${port}` })
    })
  })
})
