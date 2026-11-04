import { OvdError, type InstallResult } from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import { cli } from '../support/runCli.js'
import { fail, stubInstall } from '../support/sample.js'

const result: InstallResult = {
  installed: true,
  package: {
    path: '/home/dev/dev/player/build/armv7-release/player_armv7.vpkg',
    displayPath: '~/dev/player/build/armv7-release/player_armv7.vpkg',
    file: 'player_armv7.vpkg',
    id: 'com.example.player',
    title: 'Sample Player',
    version: '1.4.2',
    buildNumber: 142,
    architecture: 'armv7'
  },
  target: { id: 'G070000000000001', name: 'Fire TV Stick 4K Select', architecture: 'armv7' },
  forced: false
}

const mismatch = () =>
  Promise.reject(
    new OvdError(
      'ARCH_MISMATCH',
      'Architecture mismatch: package is aarch64, Fire TV Stick 4K Select is armv7',
      'Install the armv7 build instead: ovd install ~/dev/player/build/armv7-release/player_armv7.vpkg. Or pass --force to install anyway'
    )
  )

describe('ovd install', () => {
  test('--json prints the install', async () => {
    const install = vi.fn(async () => result)
    const { stdout, exitCode } = await cli(['install', 'player_armv7.vpkg', '--json'], {
      ovd: stubInstall({ install })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, install: result })
    expect(exitCode).toBe(0)
    expect(install).toHaveBeenCalledWith('player_armv7.vpkg', {})
  })

  test('passes --device and --force to core', async () => {
    const install = vi.fn(async () => ({ ...result, forced: true }))
    await cli(['install', 'p.vpkg', '--force', '--device', 'VirtualDevice', '--json'], {
      ovd: stubInstall({ install })
    })
    expect(install).toHaveBeenCalledWith('p.vpkg', { device: 'VirtualDevice', force: true })
  })

  test('without a file, installs the open .vpkg', async () => {
    const install = vi.fn(async () => result)
    await cli(['install', '--json'], { ovd: stubInstall({ install }) })
    expect(install).toHaveBeenCalledWith(undefined, {})
  })

  test('a mismatch exits 6 with the error naming both architectures', async () => {
    const { stdout, exitCode } = await cli(['install', 'player_aarch64.vpkg', '--json'], {
      ovd: stubInstall({ install: mismatch })
    })
    expect(JSON.parse(stdout)).toEqual({
      ok: false,
      error: {
        code: 'ARCH_MISMATCH',
        message: 'Architecture mismatch: package is aarch64, Fire TV Stick 4K Select is armv7',
        hint: expect.stringContaining('--force')
      }
    })
    expect(exitCode).toBe(6)
  })

  test.each([
    ['NO_TARGET', 4],
    ['TARGET_OFFLINE', 4],
    ['INSTALL_FAILED', 1],
    ['NOT_A_VPKG', 2]
  ] as const)('%s exits %i', async (code, exit) => {
    const { exitCode } = await cli(['install', 'p.vpkg', '--json'], {
      ovd: stubInstall({ install: fail(code) })
    })
    expect(exitCode).toBe(exit)
  })

  test('human output names the package and the device', async () => {
    const { stdout } = await cli(['install', 'player_armv7.vpkg'], {
      ovd: stubInstall({ install: async () => result })
    })
    expect(stdout).toBe(
      'Installed player_armv7.vpkg (com.example.player 1.4.2) on Fire TV Stick 4K Select · armv7\n'
    )
  })

  test('a forced install warns on stderr', async () => {
    const forced: InstallResult = {
      ...result,
      package: { ...result.package, architecture: 'aarch64' },
      forced: true
    }
    const { stderr } = await cli(['install', 'p.vpkg', '--force'], {
      ovd: stubInstall({ install: async () => forced })
    })
    expect(stderr).toContain(
      'installed despite the architecture mismatch (--force): package is aarch64, Fire TV Stick 4K Select is armv7'
    )
  })
})
