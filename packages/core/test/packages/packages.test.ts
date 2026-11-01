import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createPackages,
  createProject,
  createSdkLocator,
  createStateStore
} from '../../src/index.js'
import { FakeRunner } from '../support/fakeRunner.js'
import { fixture } from '../support/fixtures.js'

const APP_CONFIG = 'assets/raw/keplerscript-app-config.json'
const SHA384 =
  '0ee2046baab98d351fadaa39b6337347fe3390e5734e15055cfd1eef01f6d9c65098b7a2d0d818d02c157d59c195d222'

const out = (path: string) => ({ stdout: fixture(`0.24/${path}`) })
const err = (path: string, exitCode: number) => ({ stderr: fixture(`0.24/${path}`), exitCode })

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ovd-packages-'))
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

async function makeFile(path: string, when?: Date): Promise<string> {
  const full = join(home, path)
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, 'vpkg')
  if (when) await utimes(full, when, when)
  return full
}

// What `vpt` prints for one package, keyed by the commands core runs on `path`.
function vptScript(
  path: string,
  answers: {
    info: ReturnType<typeof out> | ReturnType<typeof err>
    contents?: string
    config?: ReturnType<typeof out> | ReturnType<typeof err>
  }
) {
  return {
    [`vega exec vpt info --json ${path}`]: answers.info,
    [`vega exec vpt show-contents ${path}`]: out(
      answers.contents ?? 'vpt-show-contents/player-armv7.txt'
    ),
    [`vega exec vpt dump ${path} ${APP_CONFIG}`]:
      answers.config ?? out('vpt-dump-app-config/release.json'),
    [`vega exec vpt checksum ${path}`]: out('vpt-checksum/player-armv7-release.txt')
  }
}

function setup(script: ConstructorParameters<typeof FakeRunner>[0] = {}) {
  const runner = new FakeRunner(script)
  const sdk = createSdkLocator(async () => ({
    vegaPath: '/sdk/vega',
    cli: 'manager',
    sdkVersion: '0.24.12112',
    cliVersion: '1.4.5'
  }))
  const project = createProject({
    state: createStateStore(join(home, '.config', 'ovd')),
    homedir: home,
    cwd: home
  })
  const packages = createPackages({ runner, sdk, project, homedir: home, cwd: home })
  return { packages, project, runner }
}

describe('Packages.info', () => {
  test('reads a Release armv7 package', async () => {
    const path = await makeFile('dev/player/build/armv7-release/player_armv7.vpkg')
    const { packages, runner } = setup(
      vptScript(path, { info: out('vpt-info/player-armv7-release.json') })
    )

    const info = await packages.info(path)

    expect(info).toMatchObject({
      path,
      displayPath: '~/dev/player/build/armv7-release/player_armv7.vpkg',
      file: 'player_armv7.vpkg',
      id: 'com.example.player',
      title: 'Sample Player',
      version: '1.4.2',
      buildNumber: 142,
      architecture: 'armv7',
      buildType: 'release',
      osVersions: ['1.2'],
      sha384: SHA384
    })
    expect(info.vptInfo).toEqual(JSON.parse(fixture('0.24/vpt-info/player-armv7-release.json')))
    // One at a time, in this order: the SDK wrapper breaks when two `vpt` calls overlap.
    expect(runner.calls.map((c) => c.args.slice(0, 3))).toEqual([
      ['exec', 'vpt', 'info'],
      ['exec', 'vpt', 'show-contents'],
      ['exec', 'vpt', 'dump'],
      ['exec', 'vpt', 'checksum']
    ])
  })

  test('reads a Debug aarch64 package', async () => {
    const path = await makeFile('player_aarch64.vpkg')
    const { packages } = setup(
      vptScript(path, {
        info: out('vpt-info/player-aarch64-debug.json'),
        contents: 'vpt-show-contents/player-aarch64.txt',
        config: out('vpt-dump-app-config/debug.json')
      })
    )
    expect(await packages.info(path)).toMatchObject({
      architecture: 'aarch64',
      buildType: 'debug'
    })
  })

  test('a pure-JS package installs on any architecture', async () => {
    const path = await makeFile('hellovega_armv7.vpkg')
    const { packages } = setup(
      vptScript(path, {
        info: out('vpt-info/hellovega-armv7-release.json'),
        contents: 'vpt-show-contents/hellovega.txt'
      })
    )
    expect(await packages.info(path)).toMatchObject({
      id: 'com.example.hellovega',
      architecture: 'any'
    })
  })

  test('a package without the app config has an unknown build type', async () => {
    const path = await makeFile('player.vpkg')
    const { packages } = setup(
      vptScript(path, {
        info: out('vpt-info/player-armv7-release.json'),
        config: err('vpt-dump-app-config/missing.stderr.txt', 1)
      })
    )
    expect((await packages.info(path)).buildType).toBe('unknown')
  })

  test('resolves a relative path and ~ against the working directory and home', async () => {
    const path = await makeFile('Downloads/player.vpkg')
    const { packages } = setup(vptScript(path, { info: out('vpt-info/player-armv7-release.json') }))
    expect((await packages.info('Downloads/player.vpkg')).path).toBe(path)
    expect((await packages.info('~/Downloads/player.vpkg')).path).toBe(path)
  })

  test('without a path, reads the .vpkg open in no-project mode', async () => {
    const path = await makeFile('Downloads/player.vpkg')
    const { packages, project } = setup(
      vptScript(path, { info: out('vpt-info/player-armv7-release.json') })
    )
    await project.open(path)
    expect((await packages.info()).path).toBe(path)
  })

  test('without a path or an open .vpkg', async () => {
    const { packages } = setup()
    await expect(packages.info()).rejects.toMatchObject({ code: 'NO_PACKAGE' })
  })

  test('a missing file', async () => {
    const { packages, runner } = setup()
    await expect(packages.info('nope.vpkg')).rejects.toMatchObject({
      code: 'PATH_NOT_FOUND',
      message: `${home}/nope.vpkg doesn’t exist`.replace(home, '~')
    })
    expect(runner.calls).toEqual([])
  })

  test.each(['notes.txt', 'build'])('%s is not a .vpkg', async (name) => {
    if (name === 'build') await mkdir(join(home, name))
    else await makeFile(name)
    const { packages, runner } = setup()
    await expect(packages.info(name)).rejects.toMatchObject({ code: 'NOT_A_VPKG' })
    expect(runner.calls).toEqual([])
  })

  test('a file vpt cannot read', async () => {
    const path = await makeFile('broken.vpkg')
    const { packages } = setup({
      [`vega exec vpt info --json ${path}`]: err('vpt-info/not-a-vpkg.stderr.txt', 1)
    })
    await expect(packages.info(path)).rejects.toMatchObject({
      code: 'NOT_A_VPKG',
      message: 'Not a .vpkg file: broken.vpkg'
    })
  })

  test('any other vpt failure names the command', async () => {
    const path = await makeFile('player.vpkg')
    const { packages } = setup({
      ...vptScript(path, { info: out('vpt-info/player-armv7-release.json') }),
      [`vega exec vpt checksum ${path}`]: { stderr: 'Error: boom\n', exitCode: 2 }
    })
    await expect(packages.info(path)).rejects.toMatchObject({
      code: 'COMMAND_FAILED',
      message: `vega exec vpt checksum ${path} failed: Error: boom`
    })
  })
})

describe('Packages.builds', () => {
  test('lists the project’s builds, newest first, without reading them', async () => {
    const project = join(home, 'dev', 'player')
    await makeFile('dev/player/manifest.toml')
    await makeFile('dev/player/package.json')
    await makeFile(
      'dev/player/build/armv7-release/player_armv7.vpkg',
      new Date('2026-11-01T14:02:00Z')
    )
    await makeFile(
      'dev/player/build/aarch64-debug/player_aarch64.vpkg',
      new Date('2026-11-01T14:05:00Z')
    )
    await makeFile('dev/player/build/archive/player-1.4.1.vpkg', new Date('2026-10-12T09:00:00Z'))
    // Intermediate packages from `react-native build-vega`, and files that aren't packages.
    await makeFile('dev/player/build/private/vega/armv7/Release/player_armv7.vpkg')
    await makeFile('dev/player/build/armv7-release/notes.txt')
    const { packages, project: projects, runner } = setup()
    await projects.open(project)

    const builds = await packages.builds()

    expect(builds).toEqual([
      expect.objectContaining({
        file: 'player_aarch64.vpkg',
        folder: 'build/aarch64-debug/',
        displayPath: '~/dev/player/build/aarch64-debug/player_aarch64.vpkg',
        size: 4,
        modifiedAt: '2026-11-01T14:05:00.000Z',
        folderArch: 'aarch64',
        folderBuildType: 'debug'
      }),
      expect.objectContaining({
        file: 'player_armv7.vpkg',
        folder: 'build/armv7-release/',
        folderArch: 'armv7',
        folderBuildType: 'release'
      }),
      expect.objectContaining({ file: 'player-1.4.1.vpkg', folder: 'build/archive/' })
    ])
    expect(builds[2]).not.toHaveProperty('folderArch')
    expect(runner.calls).toEqual([])
  })

  test('a project without a build folder has no builds', async () => {
    await makeFile('dev/player/manifest.toml')
    await makeFile('dev/player/package.json')
    const { packages, project } = setup()
    await project.open(join(home, 'dev', 'player'))
    expect(await packages.builds()).toEqual([])
  })

  test('in no-project mode, the loaded .vpkg', async () => {
    const path = await makeFile('Downloads/player-1.4.3-dev-armv7.vpkg')
    const { packages, project } = setup()
    await project.open(path)
    expect(await packages.builds()).toEqual([
      expect.objectContaining({ path, folder: '~/Downloads/', file: 'player-1.4.3-dev-armv7.vpkg' })
    ])
  })

  test('nothing open', async () => {
    const { packages } = setup()
    expect(await packages.builds()).toEqual([])
  })
})
