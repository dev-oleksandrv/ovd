import type { PackageBuild, PackageInfo } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import { ovd } from '../harness/cli.ts'
import { makeProject, makeRecordedVpkg, makeVpkg } from '../harness/project.ts'
import { createSandbox } from '../harness/vitest.ts'

const APP_CONFIG = 'assets/raw/keplerscript-app-config.json'

// SDK discovery, then the four `vpt` calls `pkg info` makes, one at a time, in this order.
const vptCalls = (path: string): string[] => [
  'vega --version',
  `vega exec vpt info --json ${path}`,
  `vega exec vpt show-contents ${path}`,
  `vega exec vpt dump ${path} ${APP_CONFIG}`,
  `vega exec vpt checksum ${path}`
]

describe('ovd pkg info', () => {
  test('reads a Release armv7 package with vpt', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()
    const path = makeRecordedVpkg(
      sandbox.home,
      'Downloads/player_armv7.vpkg',
      'player-armv7-release'
    )

    const run = await ovd(sandbox, ['pkg', 'info', '~/Downloads/player_armv7.vpkg', '--json'])

    expect(run.exitCode).toBe(0)
    expect(run.json<{ ok: true; package: PackageInfo }>().package).toMatchObject({
      path,
      displayPath: '~/Downloads/player_armv7.vpkg',
      id: 'com.example.player',
      title: 'Sample Player',
      version: '1.4.2',
      buildNumber: 142,
      architecture: 'armv7',
      buildType: 'release',
      unpackedSize: 2817790,
      osVersions: ['1.2'],
      sha384:
        '0ee2046baab98d351fadaa39b6337347fe3390e5734e15055cfd1eef01f6d9c65098b7a2d0d818d02c157d59c195d222'
    })
    expect(sandbox.calls()).toEqual(vptCalls(path))
    // Inspecting a file on the host is not a device action.
    expect(sandbox.activity()).toEqual([])
  })

  test.each([
    ['player-aarch64-debug', 'aarch64', 'debug'],
    // Pure JS: no native libraries, so it installs on any target.
    ['hellovega-armv7-release', 'any', 'release']
  ] as const)('%s reads as %s %s', async (recording, architecture, buildType) => {
    const sandbox = createSandbox()
    sandbox.installSdk()
    makeRecordedVpkg(sandbox.home, 'pkg.vpkg', recording)

    const run = await ovd(sandbox, ['pkg', 'info', 'pkg.vpkg', '--json'])

    expect(run.json<{ package: PackageInfo }>().package).toMatchObject({ architecture, buildType })
  })

  test('without a file, reads the .vpkg open in no-project mode', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()
    const path = makeRecordedVpkg(sandbox.home, 'Downloads/p.vpkg', 'player-aarch64-debug')
    expect((await ovd(sandbox, ['open', path])).exitCode).toBe(0)

    const run = await ovd(sandbox, ['pkg', 'info'])

    expect(run.exitCode).toBe(0)
    expect(run.stdout).toContain('Architecture  aarch64\n')
    expect(run.stdout).toContain('Build type    Debug\n')
    expect(sandbox.calls()).toEqual(vptCalls(path))
  })

  test('a file vpt rejects is not a .vpkg (exit 2)', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()
    const path = makeVpkg(sandbox.home)

    const run = await ovd(sandbox, ['pkg', 'info', path, '--json'])

    expect(run.exitCode).toBe(2)
    expect(run.json()).toMatchObject({
      ok: false,
      error: { code: 'NOT_A_VPKG', message: 'Not a .vpkg file: player-1.4.2-armv7.vpkg' }
    })
    expect(sandbox.calls()).toEqual(['vega --version', `vega exec vpt info --json ${path}`])
  })

  test('a missing file, and no file with nothing open, are usage errors without SDK calls', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()

    const missing = await ovd(sandbox, ['pkg', 'info', 'nope.vpkg', '--json'])
    expect(missing.exitCode).toBe(2)
    expect(missing.json()).toMatchObject({ error: { code: 'PATH_NOT_FOUND' } })

    const none = await ovd(sandbox, ['pkg', 'info', '--json'])
    expect(none.exitCode).toBe(2)
    expect(none.json()).toMatchObject({ error: { code: 'NO_PACKAGE' } })

    expect(sandbox.calls()).toEqual([])
  })
})

describe('ovd pkg list', () => {
  test('lists the open project’s builds newest first, without running vpt', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()
    makeProject(sandbox.home, 'player')
    makeRecordedVpkg(
      sandbox.home,
      'dev/player/build/armv7-release/player_armv7.vpkg',
      'player-armv7-release',
      new Date('2026-11-01T14:02:00Z')
    )
    makeRecordedVpkg(
      sandbox.home,
      'dev/player/build/aarch64-debug/player_aarch64.vpkg',
      'player-aarch64-debug',
      new Date('2026-11-01T14:05:00Z')
    )
    makeRecordedVpkg(
      sandbox.home,
      'dev/player/build/private/vega/armv7/Release/player_armv7.vpkg',
      'player-armv7-release'
    )
    await ovd(sandbox, ['open', '~/dev/player'])

    const run = await ovd(sandbox, ['pkg', 'list', '--json'])

    expect(run.exitCode).toBe(0)
    const { builds } = run.json<{ builds: PackageBuild[] }>()
    expect(builds.map((b) => [b.folder, b.file, b.folderArch, b.folderBuildType])).toEqual([
      ['build/aarch64-debug/', 'player_aarch64.vpkg', 'aarch64', 'debug'],
      ['build/armv7-release/', 'player_armv7.vpkg', 'armv7', 'release']
    ])
    expect(sandbox.calls()).toEqual([])
  })

  test('nothing open lists nothing and says how to open a project', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()

    const run = await ovd(sandbox, ['pkg', 'list'])

    expect(run.exitCode).toBe(0)
    expect(run.stdout).toBe('No project open.\n')
    expect(run.stderr).toContain('ovd open <folder|file.vpkg>')
  })
})
