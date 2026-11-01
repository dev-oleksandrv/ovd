import type { InstallResult } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import { STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'
import { ovd } from '../harness/cli.ts'
import { makeProject, makeRecordedVpkg } from '../harness/project.ts'
import { createSandbox, type Sandbox } from '../harness/vitest.ts'

const ARMV7 = 'dev/player/build/armv7-release/player_armv7.vpkg'
const AARCH64 = 'dev/player/build/aarch64-debug/player_aarch64.vpkg'

// A project with an armv7 Release and a newer aarch64 Debug build, opened.
async function playerProject(sandbox: Sandbox): Promise<{ armv7: string; aarch64: string }> {
  sandbox.installSdk()
  makeProject(sandbox.home, 'player')
  const armv7 = makeRecordedVpkg(
    sandbox.home,
    ARMV7,
    'player-armv7-release',
    new Date('2026-10-12T09:00:00Z')
  )
  const aarch64 = makeRecordedVpkg(
    sandbox.home,
    AARCH64,
    'player-aarch64-debug',
    new Date('2026-10-13T09:00:00Z')
  )
  expect((await ovd(sandbox, ['open', `${sandbox.home}/dev/player`])).exitCode).toBe(0)
  return { armv7, aarch64 }
}

const installCalls = (sandbox: Sandbox): string[] =>
  sandbox.calls().filter((c) => c.startsWith('vega device install-app'))

describe('ovd install', () => {
  test('installs a matching package on the only online device', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    const { armv7 } = await playerProject(sandbox)

    const run = await ovd(sandbox, ['install', `~/${ARMV7}`, '--json'])

    expect(run.exitCode).toBe(0)
    expect(run.json<{ ok: true; install: InstallResult }>().install).toMatchObject({
      installed: true,
      forced: false,
      package: { id: 'com.example.player', file: 'player_armv7.vpkg', architecture: 'armv7' },
      target: { id: STICK_SERIAL, architecture: 'armv7' }
    })
    expect(installCalls(sandbox)).toEqual([
      `vega device install-app -p ${armv7} --device ${STICK_SERIAL}`
    ])
    expect(sandbox.world().installed).toEqual([
      { device: STICK_SERIAL, package: 'player-armv7-release' }
    ])
    expect(sandbox.activity()).toEqual([
      expect.objectContaining({
        surface: 'cli',
        action: 'app.install',
        target: STICK_SERIAL,
        result: 'ok'
      })
    ])
  })

  test('blocks an aarch64 package on an armv7 stick and names the matching build', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    await playerProject(sandbox)

    const run = await ovd(sandbox, ['install', `~/${AARCH64}`])

    expect(run.exitCode).toBe(6)
    expect(run.stderr).toContain(
      'Error: Architecture mismatch: package is aarch64, Fire TV stick is armv7\n'
    )
    expect(run.stderr).toContain(`ovd install ~/${ARMV7}`)
    expect(installCalls(sandbox)).toEqual([])
    expect(sandbox.world().installed).toEqual([])
    expect(sandbox.activity()).toEqual([
      expect.objectContaining({
        action: 'app.install',
        result: 'error',
        errorCode: 'ARCH_MISMATCH'
      })
    ])
  })

  test('--json reports the mismatch with exit 6', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    await playerProject(sandbox)

    const run = await ovd(sandbox, ['install', `~/${AARCH64}`, '--json'])

    expect(run.exitCode).toBe(6)
    expect(run.json()).toEqual({
      ok: false,
      error: {
        code: 'ARCH_MISMATCH',
        message: 'Architecture mismatch: package is aarch64, Fire TV stick is armv7',
        hint: `Install the armv7 build instead: ovd install ~/${ARMV7}. Or pass --force to install anyway`
      }
    })
  })

  test('--force installs the mismatched package and warns', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    const { aarch64 } = await playerProject(sandbox)

    const run = await ovd(sandbox, ['install', `~/${AARCH64}`, '--force'])

    expect(run.exitCode).toBe(0)
    expect(run.stdout).toContain('Installed player_aarch64.vpkg')
    expect(run.stderr).toContain('installed despite the architecture mismatch (--force)')
    expect(installCalls(sandbox)).toEqual([
      `vega device install-app -p ${aarch64} --device ${STICK_SERIAL}`
    ])
    expect(sandbox.world().installed).toEqual([
      { device: STICK_SERIAL, package: 'player-aarch64-debug' }
    ])
  })

  test('the aarch64 build installs on the Virtual Device with --device', async () => {
    const sandbox = createSandbox({
      stick: usbStick(),
      vvd: { running: true, developerMode: true }
    })
    await playerProject(sandbox)

    const run = await ovd(sandbox, [
      'install',
      `~/${AARCH64}`,
      '--device',
      'VirtualDevice',
      '--json'
    ])

    expect(run.exitCode).toBe(0)
    expect(sandbox.world().installed).toEqual([
      { device: 'VirtualDevice', package: 'player-aarch64-debug' }
    ])
  })

  test('a pure-JS package installs on any target', async () => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()
    makeRecordedVpkg(sandbox.home, 'Downloads/hellovega.vpkg', 'hellovega-armv7-release')

    const run = await ovd(sandbox, ['install', '~/Downloads/hellovega.vpkg', '--json'])

    expect(run.exitCode).toBe(0)
    expect(run.json<{ install: InstallResult }>().install).toMatchObject({
      package: { architecture: 'any' },
      target: { id: 'VirtualDevice', architecture: 'aarch64' },
      forced: false
    })
  })

  test('without a device, nothing is read or installed (exit 4)', async () => {
    const sandbox = createSandbox()
    await playerProject(sandbox)

    const run = await ovd(sandbox, ['install', `~/${ARMV7}`, '--json'])

    expect(run.exitCode).toBe(4)
    expect(run.json()).toMatchObject({ ok: false, error: { code: 'NO_TARGET' } })
    expect(sandbox.calls().some((c) => c.includes('vpt'))).toBe(false)
    expect(sandbox.activity()).toEqual([])
  })
})
