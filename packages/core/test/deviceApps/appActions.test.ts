import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createActivityLog,
  createApps,
  createDevices,
  createPackages,
  createProject,
  createSdkLocator,
  createStateStore,
  type ActivityEntry,
  type OvdError
} from '../../src/index.js'
import { assertAppId } from '../../src/deviceApps/appId.js'
import {
  captureStartScript,
  captureStopScript,
  deviceScript
} from '../../src/deviceApps/launchScripts.js'
import { CAPTURE_SECONDS } from '../../src/deviceApps/launchVerification.js'
import { createInstallSteps } from '../../src/install/installSteps.js'
import { FakeRunner } from '../support/fakeRunner.js'
import { fixture } from '../support/fixtures.js'

const STICK = 'G070000000000001'
const VDA = 'vega exec vda devices -l'
const STATUS = 'vega virtual-device status'
const STICK_INFO = `vega device info --device ${STICK}`
const VVD_INFO = 'vega device info --device VirtualDevice'
const SHELL = 'vega exec vda -s emulator-5554 shell'
const STICK_SHELL = `vega exec vda -s ${STICK} shell`
const PLAYER = 'com.example.player'
const PKG_INFO = `${SHELL} vpm info ${PLAYER} --package`
const VLCM = `${SHELL} vlcm list`
const TERMINATE = `${SHELL} vlcm terminate-app --pkg-id ${PLAYER}`
const FORCE = `${SHELL} vlcm terminate-app --force --pkg-id ${PLAYER}`
const LAUNCH = `vega device launch-app -a ${PLAYER}.main --device VirtualDevice`
const UNINSTALL = `vega device uninstall-app -a ${PLAYER} --device VirtualDevice`
const APP_CONFIG = 'assets/raw/keplerscript-app-config.json'
// Launch verification (launchVerification.test.ts covers its cases).
const CRASH_HISTORY = `${SHELL} vlcm crash-history`
const START = `${SHELL} ${deviceScript(captureStartScript(CAPTURE_SECONDS))}`
const STOP = `${SHELL} ${deviceScript(
  captureStopScript(
    { file: '/tmp/tmp.XXXXHeBy6l', pid: 2056 },
    assertAppId(PLAYER, { from: 'argument' }),
    0
  )
)}`
const APP_LIST = `${SHELL} vlcm list --app-id ${PLAYER}.main`
const VERIFY = [
  CRASH_HISTORY,
  START,
  LAUNCH,
  ...Array<string>(5).fill(APP_LIST),
  CRASH_HISTORY,
  STOP
]
const VVD = { device: 'VirtualDevice' }

const out = (path: string, exitCode = 0) => ({ stdout: fixture(`0.24/${path}`), exitCode })
const err = (path: string, exitCode: number) => ({ stderr: fixture(`0.24/${path}`), exitCode })
const notInstalled = out('vpm-info-package/missing.txt', 248)

// A stick and the Virtual Device, both online; the Virtual Device has the player installed.
const online = {
  [VDA]: out('vda-devices/stick-usb-and-virtual-device.txt'),
  [STATUS]: out('vega-virtual-device-status/running.json'),
  [STICK_INFO]: out('vega-device-info/stick-usb.json'),
  [VVD_INFO]: out('vega-device-info/virtual-device.json'),
  [PKG_INFO]: out('vpm-info-package/player.txt'),
  // A launch the player survives. The stop of a capture without a crash has no recording; its
  // output is discarded.
  [CRASH_HISTORY]: out('vlcm-crash-history/virtual-device-before.txt'),
  [START]: out('log-capture/started.txt'),
  [APP_LIST]: out('vlcm-list/app-running.txt'),
  [STOP]: {}
}
// The Virtual Device stopped: VDA lists only the stick.
const vvdStopped = {
  [VDA]: out('vda-devices/stick-usb.txt'),
  [STATUS]: out('vega-virtual-device-status/stopped.json'),
  [STICK_INFO]: out('vega-device-info/stick-usb.json')
}

// The store app's block from the stick's recorded listing (renamed to the player there).
function storeBlock(): string {
  const blocks = fixture('0.24/vpm-info-package-all/stick.txt').split(/^(?=id:)/m)
  const block = blocks.find((b) => new RegExp(`^id:\\s+${PLAYER}\\n`).test(b))
  if (!block) throw new Error('stick.txt has no player block')
  return block
}

const RECORDED = {
  'player-armv7': {
    info: 'vpt-info/player-armv7-release.json',
    contents: 'vpt-show-contents/player-armv7.txt',
    config: 'vpt-dump-app-config/release.json',
    checksum: 'vpt-checksum/player-armv7-release.txt'
  },
  'player-aarch64': {
    info: 'vpt-info/player-aarch64-debug.json',
    contents: 'vpt-show-contents/player-aarch64.txt',
    config: 'vpt-dump-app-config/debug.json',
    checksum: 'vpt-checksum/player-aarch64-debug.txt'
  }
} as const

function vpt(path: string, name: keyof typeof RECORDED) {
  const r = RECORDED[name]
  return {
    [`vega exec vpt info --json ${path}`]: out(r.info),
    [`vega exec vpt show-contents ${path}`]: out(r.contents),
    [`vega exec vpt dump ${path} ${APP_CONFIG}`]: out(r.config),
    [`vega exec vpt checksum ${path}`]: out(r.checksum)
  }
}

const installCmd = (path: string) => `vega device install-app -p ${path} --device VirtualDevice`

let home: string
let project: string
let armv7: string
let aarch64: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ovd-app-actions-'))
  project = join(home, 'dev', 'player')
  armv7 = await makeFile('build/armv7-release/player_armv7.vpkg', new Date('2026-11-01T10:00:00Z'))
  aarch64 = await makeFile(
    'build/aarch64-debug/player_aarch64.vpkg',
    new Date('2026-11-01T11:00:00Z')
  )
  await writeFile(join(project, 'manifest.toml'), '[package]\nid = "com.example.player"\n')
  await writeFile(join(project, 'package.json'), '{}\n')
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

async function makeFile(path: string, when: Date): Promise<string> {
  const full = join(project, path)
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, 'vpkg')
  await utimes(full, when, when)
  return full
}

async function setup(
  script: ConstructorParameters<typeof FakeRunner>[0],
  opts: { open?: boolean } = {}
) {
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
  const projects = createProject({ state, homedir: home, cwd: home })
  if (opts.open) await projects.open(project)
  const packages = createPackages({ runner, sdk, project: projects, homedir: home, cwd: home })
  const install = createInstallSteps({
    runner,
    sdk,
    devices,
    packages,
    project: projects,
    homedir: home,
    cwd: home
  })
  const sleep = vi.fn(async (_ms: number) => {})
  const apps = createApps({
    runner,
    sdk,
    devices,
    project: projects,
    packages,
    activity,
    install,
    homedir: home,
    cwd: home,
    sleep
  })
  return { apps, runner, sleep }
}

async function activity(): Promise<Pick<ActivityEntry, 'action' | 'args' | 'result'>[]> {
  const text = await readFile(join(home, '.config', 'ovd', 'activity.jsonl'), 'utf8').catch(
    () => ''
  )
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const { action, target, args, result, errorCode } = JSON.parse(l) as ActivityEntry
      return { action, target, args, result, ...(errorCode ? { errorCode } : {}) }
    })
}

async function failure(promise: Promise<unknown>): Promise<OvdError> {
  return promise.then(
    () => {
      throw new Error('expected a failure')
    },
    (error: OvdError) => error
  )
}

// The commands run after the device list and info reads.
function actionCalls(runner: FakeRunner): string[] {
  return runner.calls
    .map((c) => c.display)
    .filter((d) => d.startsWith(SHELL) || /^vega device (launch|uninstall|install)-app /.test(d))
}

const vvdTarget = { id: 'VirtualDevice', name: 'Vega Virtual Device' }
const playerApp = {
  packageId: PLAYER,
  title: 'Basic UI React Native Application for project player'
}

describe('apps.launch', () => {
  test('checks the app is installed, then launches its interactive component', async () => {
    const { apps, runner } = await setup({
      ...online,
      [LAUNCH]: out('vega-device-launch-app/launched.txt')
    })

    const result = await apps.launch(PLAYER, VVD)

    expect(result).toEqual({
      target: vvdTarget,
      app: { ...playerApp, componentId: `${PLAYER}.main` },
      launched: true,
      verified: true,
      pid: 3571
    })
    expect(actionCalls(runner)).toEqual([PKG_INFO, ...VERIFY])
    expect(runner.calls.find((c) => c.display === LAUNCH)?.timeoutMs).toBe(180_000)
    expect(await activity()).toEqual([
      { action: 'app.launch', target: 'VirtualDevice', args: { app: PLAYER }, result: 'ok' }
    ])
  })

  test('not installed: no launch, and an error entry', async () => {
    const { apps, runner } = await setup({ ...online, [PKG_INFO]: notInstalled })

    const error = await failure(apps.launch(PLAYER, VVD))

    expect(error).toMatchObject({
      code: 'APP_NOT_INSTALLED',
      message: 'com.example.player isn’t installed on Vega Virtual Device'
    })
    expect(runner.count(LAUNCH)).toBe(0)
    expect(await activity()).toMatchObject([
      { action: 'app.launch', result: 'error', errorCode: 'APP_NOT_INSTALLED' }
    ])
  })

  test('the SDK says the app isn’t installed: APP_NOT_INSTALLED', async () => {
    const { apps } = await setup({
      ...online,
      [LAUNCH]: err('vega-device-launch-app/not-installed.stderr.txt', 3)
    })
    expect((await failure(apps.launch(PLAYER, VVD))).code).toBe('APP_NOT_INSTALLED')
  })

  test('a stopped Virtual Device: no shell call and no activity entry', async () => {
    const { apps, runner } = await setup(vvdStopped)

    const error = await failure(apps.launch(PLAYER, VVD))

    expect(error.code).toBe('TARGET_OFFLINE')
    expect(actionCalls(runner)).toEqual([])
    expect(await activity()).toEqual([])
  })

  test('the SDK no longer finds the device: TARGET_OFFLINE, logged', async () => {
    const { apps } = await setup({
      ...online,
      [LAUNCH]: err('vega-device-launch-app/device-not-found.stderr.txt', 2)
    })

    const error = await failure(apps.launch(PLAYER, VVD))

    expect(error).toMatchObject({
      code: 'TARGET_OFFLINE',
      hint: 'Reconnect it, then check with ovd devices'
    })
    expect(await activity()).toMatchObject([{ result: 'error', errorCode: 'TARGET_OFFLINE' }])
  })

  test('any other failure: LAUNCH_FAILED with the exit code', async () => {
    const { apps } = await setup({ ...online, [LAUNCH]: { stderr: 'boom\n', exitCode: 1 } })

    const error = await failure(apps.launch(PLAYER, VVD))

    expect(error).toMatchObject({
      code: 'LAUNCH_FAILED',
      message: 'Launch failed: boom',
      hint: 'Check the app with ovd apps info, then retry',
      details: { exitCode: 1 }
    })
  })

  test('without a ref: the open project’s app', async () => {
    const { apps } = await setup(
      { ...online, [LAUNCH]: out('vega-device-launch-app/launched.txt') },
      { open: true }
    )
    expect((await apps.launch(undefined, VVD)).app.packageId).toBe(PLAYER)
  })

  test('without a ref and nothing open: NO_APP, not logged', async () => {
    const { apps } = await setup(online)
    expect((await failure(apps.launch(undefined, VVD))).code).toBe('NO_APP')
    expect(await activity()).toEqual([])
  })
})

describe('apps.terminate', () => {
  test('stops a running app gracefully', async () => {
    const { apps, runner } = await setup({
      ...online,
      [TERMINATE]: out('vlcm-terminate-app/stopped.txt')
    })

    const result = await apps.terminate(PLAYER, VVD)

    expect(result).toEqual({ target: vvdTarget, app: playerApp, forced: false, wasRunning: true })
    expect(actionCalls(runner)).toEqual([PKG_INFO, TERMINATE])
    expect(await activity()).toEqual([
      { action: 'app.terminate', target: 'VirtualDevice', args: { app: PLAYER }, result: 'ok' }
    ])
  })

  test('an app that isn’t running: exit 255, reported as not running', async () => {
    const { apps } = await setup({
      ...online,
      [TERMINATE]: out('vlcm-terminate-app/not-running.txt', 255)
    })

    const result = await apps.terminate(PLAYER, VVD)

    expect(result.wasRunning).toBe(false)
    expect(await activity()).toMatchObject([{ action: 'app.terminate', result: 'ok' }])
  })

  test('--force: force stops, whether or not it ran', async () => {
    const { apps, runner } = await setup({
      ...online,
      [FORCE]: out('vlcm-terminate-app/force-stopped.txt')
    })

    const result = await apps.terminate(PLAYER, { ...VVD, force: true })

    expect(result).toMatchObject({ forced: true, wasRunning: null })
    expect(runner.count(FORCE)).toBe(1)
    expect(await activity()).toMatchObject([{ args: { app: PLAYER, force: 'true' } }])
  })

  test('not installed: nothing is stopped', async () => {
    const { apps, runner } = await setup({ ...online, [PKG_INFO]: notInstalled })
    expect((await failure(apps.terminate(PLAYER, VVD))).code).toBe('APP_NOT_INSTALLED')
    expect(runner.count(TERMINATE)).toBe(0)
  })

  test('a stopped Virtual Device: not logged', async () => {
    const { apps } = await setup(vvdStopped)
    expect((await failure(apps.terminate(PLAYER, VVD))).code).toBe('TARGET_OFFLINE')
    expect(await activity()).toEqual([])
  })

  test('the device leaves during the call: TARGET_OFFLINE, logged', async () => {
    const { apps } = await setup({
      ...online,
      [TERMINATE]: err('vda-shell/virtual-device-not-found.stderr.txt', 1)
    })
    expect((await failure(apps.terminate(PLAYER, VVD))).code).toBe('TARGET_OFFLINE')
    expect(await activity()).toMatchObject([{ result: 'error', errorCode: 'TARGET_OFFLINE' }])
  })

  test('any other failure: TERMINATE_FAILED with the exit code', async () => {
    const { apps } = await setup({ ...online, [TERMINATE]: { stderr: 'boom\n', exitCode: 1 } })

    const error = await failure(apps.terminate(PLAYER, VVD))

    expect(error).toMatchObject({ code: 'TERMINATE_FAILED', details: { exitCode: 1 } })
    expect(await activity()).toMatchObject([{ result: 'error', errorCode: 'TERMINATE_FAILED' }])
  })
})

describe('apps.restart', () => {
  test('a running app: graceful stop, then launch, as one entry', async () => {
    const { apps, runner } = await setup({
      ...online,
      [VLCM]: out('vlcm-list/virtual-device-player-running.txt'),
      [TERMINATE]: out('vlcm-terminate-app/stopped.txt'),
      [LAUNCH]: out('vega-device-launch-app/launched.txt')
    })

    const result = await apps.restart(PLAYER, VVD)

    expect(result).toEqual({
      target: vvdTarget,
      app: { ...playerApp, componentId: `${PLAYER}.main` },
      wasRunning: true,
      launched: true,
      verified: true,
      pid: 3571
    })
    expect(actionCalls(runner)).toEqual([PKG_INFO, VLCM, TERMINATE, ...VERIFY])
    expect(await activity()).toEqual([
      { action: 'app.restart', target: 'VirtualDevice', args: { app: PLAYER }, result: 'ok' }
    ])
  })

  test('a stopped app: only the launch', async () => {
    const { apps, runner } = await setup({
      ...online,
      [VLCM]: out('vlcm-list/virtual-device-player-stopped.txt'),
      [LAUNCH]: out('vega-device-launch-app/launched.txt')
    })

    const result = await apps.restart(PLAYER, VVD)

    expect(result.wasRunning).toBe(false)
    expect(actionCalls(runner)).toEqual([PKG_INFO, VLCM, ...VERIFY])
  })

  test('not installed', async () => {
    const { apps, runner } = await setup({ ...online, [PKG_INFO]: notInstalled })
    expect((await failure(apps.restart(PLAYER, VVD))).code).toBe('APP_NOT_INSTALLED')
    expect(runner.count(LAUNCH)).toBe(0)
  })

  test('a stopped Virtual Device: not logged', async () => {
    const { apps } = await setup(vvdStopped)
    expect((await failure(apps.restart(PLAYER, VVD))).code).toBe('TARGET_OFFLINE')
    expect(await activity()).toEqual([])
  })

  test('the stop fails: no launch', async () => {
    const { apps, runner } = await setup({
      ...online,
      [VLCM]: out('vlcm-list/virtual-device-player-running.txt'),
      [TERMINATE]: { stderr: 'boom\n', exitCode: 1 }
    })
    expect((await failure(apps.restart(PLAYER, VVD))).code).toBe('TERMINATE_FAILED')
    expect(runner.count(LAUNCH)).toBe(0)
    expect(await activity()).toMatchObject([{ action: 'app.restart', result: 'error' }])
  })

  test('the launch fails: LAUNCH_FAILED', async () => {
    const { apps } = await setup({
      ...online,
      [VLCM]: out('vlcm-list/virtual-device-player-stopped.txt'),
      [LAUNCH]: { stderr: 'boom\n', exitCode: 1 }
    })
    expect((await failure(apps.restart(PLAYER, VVD))).code).toBe('LAUNCH_FAILED')
  })
})

describe('apps.uninstall', () => {
  test('uninstalls a side-loaded app', async () => {
    const { apps, runner } = await setup({
      ...online,
      [UNINSTALL]: out('vega-device-uninstall-app/uninstalled.txt')
    })

    const result = await apps.uninstall(PLAYER, VVD)

    expect(result).toEqual({ target: vvdTarget, app: playerApp, uninstalled: true })
    expect(actionCalls(runner)).toEqual([PKG_INFO, UNINSTALL])
    expect(await activity()).toEqual([
      { action: 'app.uninstall', target: 'VirtualDevice', args: { app: PLAYER }, result: 'ok' }
    ])
  })

  test('an Appstore app is refused before any uninstall', async () => {
    const { apps, runner } = await setup({
      ...online,
      [`${STICK_SHELL} vpm info ${PLAYER} --package`]: { stdout: storeBlock() }
    })

    const error = await failure(apps.uninstall(PLAYER, { device: STICK }))

    expect(error).toMatchObject({
      code: 'NOT_SIDELOADED',
      message: 'Example Player was installed from the Appstore',
      hint: 'OVD only uninstalls apps you side-loaded'
    })
    expect(runner.calls.some((c) => c.args.includes('uninstall-app'))).toBe(false)
    expect(await activity()).toMatchObject([
      { action: 'app.uninstall', target: STICK, result: 'error', errorCode: 'NOT_SIDELOADED' }
    ])
  })

  test('not installed', async () => {
    const { apps, runner } = await setup({ ...online, [PKG_INFO]: notInstalled })
    expect((await failure(apps.uninstall(PLAYER, VVD))).code).toBe('APP_NOT_INSTALLED')
    expect(runner.count(UNINSTALL)).toBe(0)
  })

  test('the SDK says it isn’t installed: APP_NOT_INSTALLED', async () => {
    const { apps } = await setup({
      ...online,
      [UNINSTALL]: err('vega-device-uninstall-app/not-installed.stderr.txt', 3)
    })
    expect((await failure(apps.uninstall(PLAYER, VVD))).code).toBe('APP_NOT_INSTALLED')
  })

  test('a stopped Virtual Device: not logged', async () => {
    const { apps } = await setup(vvdStopped)
    expect((await failure(apps.uninstall(PLAYER, VVD))).code).toBe('TARGET_OFFLINE')
    expect(await activity()).toEqual([])
  })

  test('the SDK no longer finds the device: TARGET_OFFLINE, logged', async () => {
    const { apps } = await setup({
      ...online,
      [UNINSTALL]: err('vega-device-uninstall-app/device-not-found.stderr.txt', 2)
    })
    expect((await failure(apps.uninstall(PLAYER, VVD))).code).toBe('TARGET_OFFLINE')
    expect(await activity()).toMatchObject([{ result: 'error', errorCode: 'TARGET_OFFLINE' }])
  })

  test('any other failure: UNINSTALL_FAILED with the exit code', async () => {
    const { apps } = await setup({ ...online, [UNINSTALL]: { stderr: 'boom\n', exitCode: 1 } })
    expect(await failure(apps.uninstall(PLAYER, VVD))).toMatchObject({
      code: 'UNINSTALL_FAILED',
      message: 'Uninstall failed: boom',
      details: { exitCode: 1 }
    })
  })
})

describe('apps.reinstall', () => {
  // A function: the build paths are set in beforeEach.
  const reinstallScript = () => ({
    ...online,
    ...vpt(armv7, 'player-armv7'),
    ...vpt(aarch64, 'player-aarch64')
  })

  test('guard, uninstall, then install, as one entry', async () => {
    const { apps, runner } = await setup(
      {
        ...reinstallScript(),
        [UNINSTALL]: out('vega-device-uninstall-app/uninstalled.txt'),
        [installCmd(aarch64)]: out('vega-device-install-app/installed.txt')
      },
      { open: true }
    )

    const result = await apps.reinstall(PLAYER, VVD)

    expect(result).toEqual({
      target: { ...vvdTarget, architecture: 'aarch64' },
      app: playerApp,
      uninstalled: true,
      package: expect.objectContaining({ path: aarch64, file: 'player_aarch64.vpkg', id: PLAYER }),
      forced: false
    })
    expect(actionCalls(runner)).toEqual([PKG_INFO, UNINSTALL, installCmd(aarch64)])
    expect(await activity()).toEqual([
      {
        action: 'app.reinstall',
        target: 'VirtualDevice',
        args: { app: PLAYER, package: 'player_aarch64.vpkg' },
        result: 'ok'
      }
    ])
  })

  test('not installed: only the install', async () => {
    const { apps, runner } = await setup(
      {
        ...reinstallScript(),
        [PKG_INFO]: notInstalled,
        [installCmd(aarch64)]: out('vega-device-install-app/installed.txt')
      },
      { open: true }
    )

    const result = await apps.reinstall(PLAYER, VVD)

    expect(result.uninstalled).toBe(false)
    expect(actionCalls(runner)).toEqual([PKG_INFO, installCmd(aarch64)])
  })

  test('blocked by the guard: nothing is uninstalled or installed', async () => {
    await rm(aarch64)
    const { apps, runner } = await setup(reinstallScript(), { open: true })

    const error = await failure(apps.reinstall(PLAYER, VVD))

    expect(error).toMatchObject({
      code: 'ARCH_MISMATCH',
      hint: 'Build the app for aarch64 or switch the target. Or pass --force to reinstall anyway'
    })
    expect(actionCalls(runner)).toEqual([])
    expect(await activity()).toMatchObject([
      { action: 'app.reinstall', result: 'error', errorCode: 'ARCH_MISMATCH' }
    ])
  })

  test('--force reinstalls a mismatched package', async () => {
    await rm(aarch64)
    const { apps } = await setup(
      {
        ...reinstallScript(),
        [UNINSTALL]: out('vega-device-uninstall-app/uninstalled.txt'),
        [installCmd(armv7)]: out('vega-device-install-app/installed-wrong-arch.txt')
      },
      { open: true }
    )

    const result = await apps.reinstall(PLAYER, { ...VVD, force: true })

    expect(result).toMatchObject({ forced: true, package: { path: armv7 } })
    expect(await activity()).toMatchObject([{ args: { force: 'true' }, result: 'ok' }])
  })

  test('a project folder ref, with nothing open', async () => {
    const { apps } = await setup({
      ...reinstallScript(),
      [UNINSTALL]: out('vega-device-uninstall-app/uninstalled.txt'),
      [installCmd(aarch64)]: out('vega-device-install-app/installed.txt')
    })

    const result = await apps.reinstall('~/dev/player', VVD)

    expect(result.package.path).toBe(aarch64)
  })

  test('no ref, with an open folder that has no build: NO_PACKAGE, no device call', async () => {
    await rm(join(project, 'build'), { recursive: true })
    const { apps, runner } = await setup(reinstallScript(), { open: true })

    const error = await failure(apps.reinstall(undefined, VVD))

    expect(error.code).toBe('NO_PACKAGE')
    expect(runner.calls).toEqual([])
    expect(await activity()).toEqual([])
  })

  test('an installed Appstore app is refused before the uninstall', async () => {
    const { apps, runner } = await setup(
      {
        ...reinstallScript(),
        [`${STICK_SHELL} vpm info ${PLAYER} --package`]: { stdout: storeBlock() }
      },
      { open: true }
    )

    const error = await failure(apps.reinstall(PLAYER, { device: STICK }))

    expect(error.code).toBe('NOT_SIDELOADED')
    expect(runner.calls.some((c) => /(un)?install-app/.test(c.display))).toBe(false)
  })

  test('the uninstall fails: nothing is installed', async () => {
    const { apps, runner } = await setup(
      { ...reinstallScript(), [UNINSTALL]: { stderr: 'boom\n', exitCode: 1 } },
      { open: true }
    )
    expect((await failure(apps.reinstall(PLAYER, VVD))).code).toBe('UNINSTALL_FAILED')
    expect(runner.count(installCmd(aarch64))).toBe(0)
  })

  test('a stopped Virtual Device: not logged', async () => {
    const { apps } = await setup(vvdStopped, { open: true })
    expect((await failure(apps.reinstall(PLAYER, VVD))).code).toBe('TARGET_OFFLINE')
    expect(await activity()).toEqual([])
  })
})

describe('an app ID that isn’t one', () => {
  const EVIL = 'x;rm -rf ~'
  const ACTIONS = ['launch', 'terminate', 'restart', 'uninstall', 'reinstall'] as const
  type Action = (typeof ACTIONS)[number]
  type Apps = Awaited<ReturnType<typeof setup>>['apps']
  const act = (apps: Apps, action: Action, ref: string | undefined) => apps[action](ref, VVD)

  // A .vpkg whose package ID is EVIL: the recorded player package with its ID swapped.
  function evilVpt(path: string) {
    const info = fixture(`0.24/${RECORDED['player-aarch64'].info}`)
    expect(info).toContain(`"id": "${PLAYER}"`)
    return {
      ...vpt(path, 'player-aarch64'),
      [`vega exec vpt info --json ${path}`]: {
        stdout: info.replace(`"id": "${PLAYER}"`, `"id": ${JSON.stringify(EVIL)}`)
      }
    }
  }

  // A cloned project whose manifest has EVIL as its package ID, built for the target.
  async function evilProject(): Promise<{ folder: string; build: string }> {
    const folder = join(home, 'dev', 'evil')
    const build = join(folder, 'build', 'aarch64-debug', 'evil_aarch64.vpkg')
    await mkdir(join(build, '..'), { recursive: true })
    await writeFile(join(folder, 'manifest.toml'), `[package]\nid = ${JSON.stringify(EVIL)}\n`)
    await writeFile(join(folder, 'package.json'), '{}\n')
    await writeFile(build, 'vpkg')
    return { folder, build }
  }

  test.each(ACTIONS)('%s: from the argument, refused before any SDK call', async (action) => {
    const { apps, runner } = await setup(online)

    const error = await failure(act(apps, action, EVIL))

    expect(error).toMatchObject({
      code: 'INVALID_APP_ID',
      message: '"x;rm -rf ~" isn’t an app ID',
      hint: 'An app ID is letters, digits, dots, hyphens and underscores, like com.example.player'
    })
    expect(runner.calls).toEqual([])
    expect(await activity()).toEqual([])
  })

  test.each<[Action, string]>([
    ['launch', 'The package ID in ~/dev/evil/manifest.toml isn’t an app ID: "x;rm -rf ~"'],
    ['terminate', 'The package ID in ~/dev/evil/manifest.toml isn’t an app ID: "x;rm -rf ~"'],
    ['restart', 'The package ID in ~/dev/evil/manifest.toml isn’t an app ID: "x;rm -rf ~"'],
    ['uninstall', 'The package ID in ~/dev/evil/manifest.toml isn’t an app ID: "x;rm -rf ~"'],
    // Reinstall sends the ID of the folder's build, not the manifest's.
    ['reinstall', 'The package ID in evil_aarch64.vpkg isn’t an app ID: "x;rm -rf ~"']
  ])('%s: from a project folder, refused before any device action', async (action, message) => {
    const { folder, build } = await evilProject()
    const { apps, runner } = await setup({ ...online, ...evilVpt(build) })

    const error = await failure(act(apps, action, folder))

    expect(error).toMatchObject({ code: 'INVALID_APP_ID', message })
    expect(actionCalls(runner)).toEqual([])
    if (action !== 'reinstall') expect(runner.calls).toEqual([])
    expect(await activity()).toEqual([])
  })

  test.each(ACTIONS.filter((a) => a !== 'reinstall'))(
    '%s: from the open project’s manifest, refused before any SDK call',
    async (action) => {
      const { folder } = await evilProject()
      const { apps, runner } = await setup(online)
      await createProject({
        state: createStateStore(join(home, '.config', 'ovd')),
        homedir: home,
        cwd: home
      }).open(folder)

      expect((await failure(act(apps, action, undefined))).code).toBe('INVALID_APP_ID')
      expect(runner.calls).toEqual([])
    }
  )

  test.each(ACTIONS)('%s: from a .vpkg, refused before any device action', async (action) => {
    const path = join(home, 'Downloads', 'evil.vpkg')
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, 'vpkg')
    const { apps, runner } = await setup({ ...online, ...evilVpt(path) })

    const error = await failure(act(apps, action, path))

    expect(error).toMatchObject({
      code: 'INVALID_APP_ID',
      message: 'The package ID in evil.vpkg isn’t an app ID: "x;rm -rf ~"'
    })
    // Only the host reads the package (and, for reinstall, picks the target) first.
    expect(actionCalls(runner)).toEqual([])
    expect(runner.calls.filter((c) => c.display.startsWith('vega exec vda -s'))).toEqual([])
    expect(await activity()).toEqual([])
  })

  const badPackageId = (b: string) =>
    b.replace(`id:           ${PLAYER}\n`, 'id:           $(id)\n')
  const badComponentId = (b: string) => b.replace(`\t${PLAYER}.main\n`, `\t${PLAYER}.$(id)\n`)
  test.each<[string, Action, (block: string) => string]>([
    ['package ID', 'terminate', badPackageId],
    ['package ID', 'uninstall', badPackageId],
    ['component ID', 'launch', badComponentId]
  ])('a %s from the device that isn’t one: no %s, an error entry', async (_what, action, edit) => {
    const block = fixture('0.24/vpm-info-package/player.txt')
    expect(edit(block)).not.toBe(block)
    const { apps, runner } = await setup({ ...online, [PKG_INFO]: { stdout: edit(block) } })

    const error = await failure(act(apps, action, PLAYER))

    expect(error.code).toBe('INVALID_APP_ID')
    expect(error.message).toMatch(/^Vega Virtual Device reported an ID that isn’t an app ID: /)
    expect(actionCalls(runner)).toEqual([PKG_INFO])
    expect(await activity()).toMatchObject([
      { action: `app.${action}`, result: 'error', errorCode: 'INVALID_APP_ID' }
    ])
  })
})
