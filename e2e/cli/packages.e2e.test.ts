import type {
  PackageBuild,
  PackageFiles,
  PackageInfo,
  PackageManifest,
  PackageValidation
} from '@ovd/core'
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

// Stage 5.3: the broken sample (`build-number = 0`, `launch-type = "sometimes"`, `min = "9.9"`)
// and the valid one, recorded with vpt dump and validate (fixtures/0.24/README.md).
describe('ovd pkg validate | manifest | files', () => {
  function brokenPackage() {
    const sandbox = createSandbox()
    sandbox.installSdk()
    const path = makeRecordedVpkg(
      sandbox.home,
      'Downloads/player_aarch64.vpkg',
      'player-aarch64-broken'
    )
    return { sandbox, path }
  }

  test('validate: a broken manifest exits 1 with its exact errors and lines', async () => {
    const { sandbox, path } = brokenPackage()

    const run = await ovd(sandbox, ['pkg', 'validate', path, '--json'])

    expect(run.exitCode).toBe(1)
    const doc = run.json<{ ok: false; error: { code: string }; validation: PackageValidation }>()
    expect(doc.ok).toBe(false)
    expect(doc.error.code).toBe('PACKAGE_INVALID')
    expect(doc.validation).toMatchObject({ valid: false, errors: 3, infos: 5 })
    expect(
      doc.validation.issues
        .filter((i) => i.severity === 'error')
        .map((i) => [i.key, i.file ?? null, i.line ?? null, i.column ?? null])
    ).toEqual([
      ['package.build-number', 'manifest.toml', 7, 16],
      ['components.interactive.launch-type', 'manifest.toml', 33, 15],
      ['os.version', null, null, null]
    ])
    expect(sandbox.calls()).toEqual(['vega --version', `vega exec vpt validate --no-color ${path}`])
    expect(sandbox.activity()).toEqual([])
  })

  test('validate: the human table goes to stdout, the error to stderr', async () => {
    const { sandbox } = brokenPackage()

    const run = await ovd(sandbox, ['pkg', 'validate', '~/Downloads/player_aarch64.vpkg'])

    expect(run.exitCode).toBe(1)
    expect(run.stdout).toContain('player_aarch64.vpkg is invalid: 3 errors, 5 notes\n')
    expect(run.stdout).toMatch(
      /error +manifest\.toml:33:15 +\[components\.interactive\.launch-type\] 'sometimes' launch type/
    )
    expect(run.stderr).toContain('Error: player_aarch64.vpkg has 3 errors\n')
  })

  test('validate: a valid package exits 0 with no errors', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()
    const path = makeRecordedVpkg(sandbox.home, 'p.vpkg', 'player-aarch64-release')

    const run = await ovd(sandbox, ['pkg', 'validate', path, '--json'])

    expect(run.exitCode).toBe(0)
    expect(run.json<{ ok: true; validation: PackageValidation }>()).toMatchObject({
      ok: true,
      validation: { valid: true, errors: 0, infos: 5 }
    })
  })

  test('manifest: the packaged manifest with the errors under their lines, exit 0', async () => {
    const { sandbox, path } = brokenPackage()

    const run = await ovd(sandbox, ['pkg', 'manifest', path, '--json'])

    expect(run.exitCode).toBe(0)
    const { manifest } = run.json<{ manifest: PackageManifest }>()
    expect(manifest.lines[6]).toBe('build-number = 0')
    expect(manifest.lines[32]).toBe('launch-type = "sometimes"')
    expect(manifest.validation.errors).toBe(3)
    expect(sandbox.calls()).toEqual([
      'vega --version',
      `vega exec vpt dump ${path} manifest.toml`,
      `vega exec vpt validate --no-color ${path}`
    ])

    const human = await ovd(sandbox, ['pkg', 'manifest', path])
    expect(human.stdout).toContain(
      '33 | launch-type = "sometimes"\n   |               ^ error: [components.interactive.launch-type]'
    )
    expect(human.stdout).toMatch(/^error: \[os\.version\] contains value\(s\)/)
  })

  test('files: the tree of the package, manifest.toml at the top level', async () => {
    const { sandbox, path } = brokenPackage()

    const run = await ovd(sandbox, ['pkg', 'files', path, '--json'])

    expect(run.exitCode).toBe(0)
    const { files } = run.json<{ files: PackageFiles }>()
    expect(files.entries).toHaveLength(18)
    expect(files.tree.map((n) => n.name)).toEqual([
      'assets',
      'bundle',
      'meta-info',
      'manifest.toml'
    ])
    expect(sandbox.calls()).toEqual(['vega --version', `vega exec vpt show-contents ${path}`])

    const human = await ovd(sandbox, ['pkg', 'files', path])
    expect(human.stdout).toContain('assets/\n  raw/\n    keplerscript-app-config.json\n')
    expect(human.stdout).toContain('\nmanifest.toml\n18 files\n')
  })

  test.each([
    ['validate', 'vega exec vpt validate --no-color'],
    ['manifest', 'vega exec vpt dump']
  ])('%s: a file vpt rejects is not a .vpkg (exit 2)', async (sub, call) => {
    const sandbox = createSandbox()
    sandbox.installSdk()
    const path = makeVpkg(sandbox.home)

    const run = await ovd(sandbox, ['pkg', sub, path, '--json'])

    expect(run.exitCode).toBe(2)
    expect(run.json()).toMatchObject({ ok: false, error: { code: 'NOT_A_VPKG' } })
    expect(sandbox.calls()).toEqual(['vega --version', expect.stringContaining(call)])
  })
})
