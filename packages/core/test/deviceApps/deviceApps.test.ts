import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createActivityLog,
  createApps,
  createDevices,
  createPackages,
  createProject,
  createSdkLocator,
  createStateStore,
  type OvdError
} from '../../src/index.js'
import { createInstallSteps } from '../../src/install/installSteps.js'
import { FakeRunner } from '../support/fakeRunner.js'
import { fixture } from '../support/fixtures.js'

const VDA = 'vega exec vda devices -l'
const STATUS = 'vega virtual-device status'
const STICK_INFO = 'vega device info --device G070000000000001'
const VVD_INFO = 'vega device info --device VirtualDevice'
const SHELL = 'vega exec vda -s emulator-5554 shell'
// The script the vpm-info-package-all fixtures were recorded with (fixtures/0.24/README.md).
const ALL_PACKAGES_SCRIPT = `d=$(mktemp -d) || exit 1
vpm list packages | tail -n +2 | xargs -P4 -n1 sh -c 'vpm info --package "$1" > "$0/$1"' "$d"
cat "$d"/*
s=$?
rm -rf "$d"
exit $s
`
const ALL_PACKAGES = `echo ${Buffer.from(ALL_PACKAGES_SCRIPT).toString('base64')} | base64 -d | sh`
const ALL = `${SHELL} ${ALL_PACKAGES}`
const STICK_SHELL = 'vega exec vda -s G070000000000001 shell'
const VLCM = `${SHELL} vlcm list`
const MAIN_INFO = `${SHELL} vpm info com.example.player.main`

const out = (path: string) => ({ stdout: fixture(`0.24/${path}`) })

// A stick and the Virtual Device, both online; the Virtual Device has the player installed.
const online = {
  [VDA]: out('vda-devices/stick-usb-and-virtual-device.txt'),
  [STATUS]: out('vega-virtual-device-status/running.json'),
  [STICK_INFO]: out('vega-device-info/stick-usb.json'),
  [VVD_INFO]: out('vega-device-info/virtual-device.json'),
  [ALL]: out('vpm-info-package-all/virtual-device-player.txt'),
  [MAIN_INFO]: out('vpm-info-component/player-main.txt')
}
const running = { ...online, [VLCM]: out('vlcm-list/virtual-device-player-running.txt') }
const stopped = { ...online, [VLCM]: out('vlcm-list/virtual-device-player-stopped.txt') }
const VVD = { device: 'VirtualDevice' }

let home: string
let project: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ovd-apps-'))
  project = join(home, 'dev', 'player')
  await mkdir(project, { recursive: true })
  await writeFile(join(project, 'manifest.toml'), '[package]\nid = "com.example.player"\n')
  await writeFile(join(project, 'package.json'), '{}\n')
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

async function setup(script: ConstructorParameters<typeof FakeRunner>[0]) {
  const runner = new FakeRunner(script)
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
  const project = createProject({ state, homedir: home, cwd: home })
  const packages = createPackages({ runner, sdk, project, homedir: home, cwd: home })
  const install = createInstallSteps({
    runner,
    sdk,
    devices,
    packages,
    project,
    homedir: home,
    cwd: home
  })
  const apps = createApps({
    runner,
    sdk,
    devices,
    project,
    packages,
    activity,
    install,
    homedir: home,
    cwd: home
  })
  return { apps, project, runner }
}

async function failure(promise: Promise<unknown>): Promise<OvdError> {
  return promise.then(
    () => {
      throw new Error('expected a failure')
    },
    (error: OvdError) => error
  )
}

describe('apps.list', () => {
  test('side-loaded apps with their running state, in two device calls', async () => {
    const { apps, runner } = await setup(running)
    const list = await apps.list(VVD)

    expect(list.target).toEqual({ id: 'VirtualDevice', name: 'Vega Virtual Device' })
    expect(list.apps).toEqual([
      {
        packageId: 'com.example.player',
        title: 'Basic UI React Native Application for project player',
        version: '0.1.0',
        buildNumber: 1,
        installedAt: '2026-11-05T23:10:04.000Z',
        updatedAt: '2026-11-05T23:10:04.000Z',
        source: 'sideloaded',
        components: [
          {
            id: 'com.example.player.main',
            running: {
              pid: expect.any(Number),
              state: 'VISIBLE',
              lifespan: 'PERMANENT',
              container: expect.stringMatching(/^framework\.slice\//)
            }
          }
        ],
        status: { state: 'running', pid: expect.any(Number), lifespan: 'PERMANENT' }
      }
    ])
    expect(runner.count(ALL)).toBe(1)
    expect(runner.count(VLCM)).toBe(1)
  })

  test('a stopped app', async () => {
    const { apps } = await setup(stopped)
    const [player] = (await apps.list(VVD)).apps
    expect(player?.status).toEqual({ state: 'stopped' })
    expect(player?.components).toEqual([{ id: 'com.example.player.main' }])
  })

  test('--running leaves out stopped apps', async () => {
    expect((await (await setup(stopped)).apps.list({ ...VVD, running: true })).apps).toEqual([])
    expect((await (await setup(running)).apps.list({ ...VVD, running: true })).apps).toHaveLength(1)
  })

  test('--all adds system apps after side-loaded ones; libraries without components stay out', async () => {
    const { apps } = await setup(running)
    const list = (await apps.list({ ...VVD, all: true })).apps
    expect(list[0]?.packageId).toBe('com.example.player')
    expect(list.slice(1).every((a) => a.source === 'system')).toBe(true)
    expect(list.every((a) => a.components.length > 0)).toBe(true)
    // The launcher runs on the Virtual Device.
    expect(list.find((a) => a.packageId === 'com.amazon.keplerlauncherapp')?.status.state).toBe(
      'running'
    )
  })

  test('a stick: store apps after side-loaded ones, marked as such; system apps hidden', async () => {
    const { apps } = await setup({
      ...online,
      [`${STICK_SHELL} ${ALL_PACKAGES}`]: out('vpm-info-package-all/stick.txt'),
      [`${STICK_SHELL} vlcm list`]: out('vlcm-list/stick.txt')
    })
    const list = await apps.list({ device: 'G070000000000001' })
    expect(list.target.name).toBe('Fire TV stick')
    expect(list.apps).toEqual([
      expect.objectContaining({
        packageId: 'com.example.player',
        title: 'Example Player',
        source: 'store',
        status: { state: 'stopped' }
      })
    ])
    const all = (await apps.list({ device: 'G070000000000001', all: true })).apps
    expect(all[0]?.source).toBe('store')
    expect(all.slice(1).every((a) => a.source === 'system')).toBe(true)
  })

  test('nothing side-loaded', async () => {
    const { apps } = await setup({
      ...stopped,
      [ALL]: out('vpm-info-package-all/virtual-device.txt')
    })
    expect((await apps.list(VVD)).apps).toEqual([])
  })

  test('a stopped Virtual Device', async () => {
    const { apps, runner } = await setup({
      [VDA]: out('vda-devices/stick-usb.txt'),
      [STATUS]: out('vega-virtual-device-status/stopped.json'),
      [STICK_INFO]: out('vega-device-info/stick-usb.json')
    })
    const error = await failure(apps.list(VVD))
    expect(error.code).toBe('TARGET_OFFLINE')
    expect(error.hint).toContain('ovd vvd start')
    expect(runner.count(ALL)).toBe(0)
  })

  test('the device leaves during the call', async () => {
    // What VDA printed when the Virtual Device dropped right after boot (2026-11-06).
    const { apps } = await setup({
      ...stopped,
      [ALL]: { stderr: "vda: device 'emulator-5554' not found\n", exitCode: 1 }
    })
    expect((await failure(apps.list(VVD))).code).toBe('TARGET_OFFLINE')
  })

  test('the device shell fails', async () => {
    const { apps } = await setup({ ...stopped, [VLCM]: { stderr: 'boom', exitCode: 1 } })
    expect((await failure(apps.list(VVD))).code).toBe('COMMAND_FAILED')
  })
})

describe('apps.info', () => {
  const main = {
    id: 'com.example.player.main',
    type: 'interactive',
    launchType: 'singleton',
    running: expect.objectContaining({ state: 'VISIBLE' })
  }

  test.each([
    ['package ID', 'com.example.player'],
    ['component ID', 'com.example.player.main']
  ])('by %s, with component details', async (_name, ref) => {
    const { apps, runner } = await setup(running)
    const { app } = await apps.info(ref, VVD)
    expect(app.packageId).toBe('com.example.player')
    expect(app.components).toEqual([main])
    expect(runner.count(MAIN_INFO)).toBe(1)
  })

  test('by project folder', async () => {
    const { apps } = await setup(running)
    expect((await apps.info(project, VVD)).app.packageId).toBe('com.example.player')
  })

  test('without a ref: the open project’s app', async () => {
    const { apps, project: projects } = await setup(running)
    await projects.open(project)
    expect((await apps.info(undefined, VVD)).app.packageId).toBe('com.example.player')
  })

  test('without a ref and nothing open', async () => {
    const { apps } = await setup(running)
    expect((await failure(apps.info(undefined, VVD))).code).toBe('NO_APP')
  })

  test('a folder that isn’t a Vega project', async () => {
    const { apps } = await setup(running)
    expect((await failure(apps.info(home, VVD))).code).toBe('NOT_A_PROJECT')
  })

  test('not installed', async () => {
    const { apps, runner } = await setup({
      ...stopped,
      [ALL]: out('vpm-info-package-all/virtual-device.txt')
    })
    const error = await failure(apps.info('com.example.player', VVD))
    expect(error.code).toBe('APP_NOT_INSTALLED')
    expect(error.message).toBe('com.example.player isn’t installed on Vega Virtual Device')
    expect(runner.count(MAIN_INFO)).toBe(0)
  })

  test('uninstalled between the list and the component call', async () => {
    const { apps } = await setup({
      ...running,
      [MAIN_INFO]: { stdout: fixture('0.24/vpm-info-component/missing.txt'), exitCode: 248 }
    })
    const { app } = await apps.info('com.example.player', VVD)
    expect(app.components).toEqual([
      { id: 'com.example.player.main', running: expect.objectContaining({ state: 'VISIBLE' }) }
    ])
  })
})
