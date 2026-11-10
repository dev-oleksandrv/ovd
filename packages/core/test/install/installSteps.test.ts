import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createActivityLog,
  createDevices,
  createPackages,
  createProject,
  createSdkLocator,
  createStateStore,
  type BuildType
} from '../../src/index.js'
import { createInstallSteps } from '../../src/install/installSteps.js'
import { FakeRunner } from '../support/fakeRunner.js'
import { fixture } from '../support/fixtures.js'

const out = (path: string) => ({ stdout: fixture(`0.24/${path}`) })

// The build folders `react-native build-vega` writes (ARCHITECTURE §8), oldest first.
const FOLDERS = ['armv7-release', 'armv7-debug', 'aarch64-debug', 'aarch64-release'] as const
type Folder = (typeof FOLDERS)[number]

let home: string
let project: string
let paths: Record<Folder, string>

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ovd-install-steps-'))
  project = join(home, 'dev', 'player')
  const made: Partial<Record<Folder, string>> = {}
  for (const [i, folder] of FOLDERS.entries()) {
    const arch = folder.split('-')[0] ?? ''
    const path = join(project, 'build', folder, `player_${arch}.vpkg`)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, 'vpkg')
    const when = new Date(Date.UTC(2026, 10, 1, 10 + i))
    await utimes(path, when, when)
    made[folder] = path
  }
  paths = made as Record<Folder, string>
  await writeFile(join(project, 'manifest.toml'), '[package]\nid = "com.example.player"\n')
  await writeFile(join(project, 'package.json'), '{}\n')
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

// Each build's `vpt show-contents`, by the architecture its folder names (the recorded player
// packages, fixtures/0.24/README.md).
function contents(): Record<string, { stdout: string }> {
  const script: Record<string, { stdout: string }> = {}
  for (const folder of FOLDERS) {
    const recorded = folder.startsWith('armv7') ? 'player-armv7' : 'player-aarch64'
    script[`vega exec vpt show-contents ${paths[folder]}`] = out(
      `vpt-show-contents/${recorded}.txt`
    )
  }
  return script
}

async function setup() {
  const runner = new FakeRunner(contents())
  const sdk = createSdkLocator(async () => ({
    vegaPath: '/sdk/vega',
    cli: 'manager',
    sdkVersion: '0.24.12112',
    cliVersion: '1.4.5'
  }))
  const ovdHome = join(home, '.config', 'ovd')
  const state = createStateStore(ovdHome)
  const activity = createActivityLog({ home: ovdHome, surface: 'cli' })
  const devices = createDevices({ runner, sdk, state, activity, env: {} })
  const projects = createProject({ state, homedir: home, cwd: home })
  await projects.open(project)
  const packages = createPackages({ runner, sdk, project: projects, homedir: home, cwd: home })
  const steps = createInstallSteps({
    runner,
    sdk,
    devices,
    packages,
    project: projects,
    homedir: home,
    cwd: home
  })
  return { steps, runner }
}

const target = (architecture: string) => async () => ({ id: 'x', name: 'x', architecture })

describe('InstallSteps.resolve with prefer', () => {
  test.each<[string, BuildType | undefined, Folder]>([
    ['aarch64', 'debug', 'aarch64-debug'],
    ['aarch64', 'release', 'aarch64-release'],
    ['aarch64', undefined, 'aarch64-release'],
    ['armv7', 'release', 'armv7-release'],
    ['armv7', 'debug', 'armv7-debug'],
    ['armv7', undefined, 'armv7-debug']
  ])('an %s target, prefer %s: %s', async (arch, prefer, picked) => {
    const { steps } = await setup()

    const resolved = await steps.resolve(undefined, target(arch), prefer)

    expect(resolved.path).toBe(paths[picked])
    expect(resolved.build?.folderBuildType).toBe(picked.split('-')[1])
  })

  test('without a build of the preferred type, the newest match', async () => {
    await rm(paths['aarch64-debug'])
    const { steps } = await setup()

    const resolved = await steps.resolve(undefined, target('aarch64'), 'debug')

    expect(resolved.path).toBe(paths['aarch64-release'])
  })

  test('a preferred build of another architecture is never picked', async () => {
    await rm(paths['armv7-debug'])
    const { steps } = await setup()

    const resolved = await steps.resolve(undefined, target('armv7'), 'debug')

    expect(resolved.path).toBe(paths['armv7-release'])
  })

  test('a .vpkg ref is used as it is, whatever the preference', async () => {
    const { steps, runner } = await setup()

    const resolved = await steps.resolve(paths['armv7-release'], target('aarch64'), 'debug')

    expect(resolved).toEqual({ path: paths['armv7-release'] })
    expect(runner.calls).toEqual([])
  })
})
