import type { FolderProject, PackageBuild, PackageInfo } from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import { cli } from '../support/runCli.js'
import { fail, stubPackages } from '../support/sample.js'

const info: PackageInfo = {
  path: '/home/dev/dev/player/build/armv7-release/player_armv7.vpkg',
  displayPath: '~/dev/player/build/armv7-release/player_armv7.vpkg',
  file: 'player_armv7.vpkg',
  id: 'com.example.player',
  title: 'Sample Player',
  version: '1.4.2',
  buildNumber: 142,
  size: 2817790,
  architecture: 'armv7',
  buildType: 'release',
  osVersions: ['1.2'],
  contractPackageVersion: '1.0.323.0',
  sha384: '0ee2046b',
  modifiedAt: '2026-11-01T14:02:00.000Z',
  vptInfo: { id: 'com.example.player' }
}

const folder: FolderProject = {
  kind: 'folder',
  path: '/home/dev/dev/player',
  displayPath: '~/dev/player',
  name: 'player'
}

const build: PackageBuild = {
  path: info.path,
  displayPath: info.displayPath,
  file: 'player_armv7.vpkg',
  folder: 'build/armv7-release/',
  size: 2817790,
  modifiedAt: '2026-11-01T14:02:00.000Z',
  folderArch: 'armv7',
  folderBuildType: 'release'
}

describe('ovd pkg info', () => {
  test('--json prints the package', async () => {
    const read = vi.fn(async () => info)
    const { stdout, exitCode } = await cli(['pkg', 'info', 'player_armv7.vpkg', '--json'], {
      ovd: stubPackages({ info: read })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, package: info })
    expect(exitCode).toBe(0)
    expect(read).toHaveBeenCalledWith('player_armv7.vpkg')
  })

  test('without a file, reads the open .vpkg', async () => {
    const read = vi.fn(async () => info)
    await cli(['pkg', 'info', '--json'], { ovd: stubPackages({ info: read }) })
    expect(read).toHaveBeenCalledWith(undefined)
  })

  test('human output lists the package’s rows', async () => {
    const { stdout } = await cli(['pkg', 'info', 'x.vpkg'], {
      ovd: stubPackages({ info: async () => ({ ...info, architecture: 'any' }) })
    })
    expect(stdout).toContain('Version       1.4.2 (142)\n')
    expect(stdout).toContain('Architecture  any (no native code)\n')
    expect(stdout).toContain('Build type    Release\n')
    expect(stdout).toContain('Size          2.8 MB\n')
  })

  test.each(['NO_PACKAGE', 'NOT_A_VPKG', 'PATH_NOT_FOUND'] as const)(
    '%s is a usage error (exit 2)',
    async (code) => {
      const { stdout, exitCode } = await cli(['pkg', 'info', '--json'], {
        ovd: stubPackages({ info: fail(code) })
      })
      expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code } })
      expect(exitCode).toBe(2)
    }
  )

  test('an SDK failure exits 1', async () => {
    const { exitCode } = await cli(['pkg', 'info', 'x.vpkg', '--json'], {
      ovd: stubPackages({ info: fail('COMMAND_FAILED') })
    })
    expect(exitCode).toBe(1)
  })
})

describe('ovd pkg list', () => {
  test('--json prints the builds', async () => {
    const { stdout, exitCode } = await cli(['pkg', 'list', '--json'], {
      ovd: stubPackages({ builds: async () => [build] }, { current: async () => folder })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, builds: [build] })
    expect(exitCode).toBe(0)
  })

  test('human output shows each build with its folder hints', async () => {
    const { stdout } = await cli(['pkg', 'list'], {
      ovd: stubPackages({ builds: async () => [build] }, { current: async () => folder })
    })
    expect(stdout).toMatch(
      /^build\/armv7-release\/player_armv7\.vpkg {2}armv7 {2}Release {2}2\.8 MB {2}2026-11-0\d \d\d:\d\d\n$/
    )
  })

  test('nothing open', async () => {
    const { stdout, stderr, exitCode } = await cli(['pkg', 'list'], {
      ovd: stubPackages({ builds: async () => [] }, { current: async () => null })
    })
    expect(stdout).toBe('No project open.\n')
    expect(stderr).toContain('ovd open')
    expect(exitCode).toBe(0)
  })

  test('a project without builds', async () => {
    const { stdout } = await cli(['pkg', 'list'], {
      ovd: stubPackages({ builds: async () => [] }, { current: async () => folder })
    })
    expect(stdout).toBe('No builds in build/.\n')
  })
})
