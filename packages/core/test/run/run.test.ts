import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createActivityLog,
  createApps,
  createDevices,
  createInstall,
  createPackages,
  createProject,
  createRun,
  createSdkLocator,
  createStateStore,
  preferredBuildType,
  type ActivityEntry,
  type OvdError,
  type RunOptions,
  type RunStep
} from '../../src/index.js'
import { assertAppId } from '../../src/deviceApps/appId.js'
import {
  acrScript,
  captureStartScript,
  captureStopScript,
  deviceScript
} from '../../src/deviceApps/launchScripts.js'
import { CAPTURE_SECONDS } from '../../src/deviceApps/launchVerification.js'
import { createInstallSteps } from '../../src/install/installSteps.js'
import { FakeRunner } from '../support/fakeRunner.js'
import { fixture } from '../support/fixtures.js'

const STICK = 'G070000000000001'
const PLAYER = 'com.example.player'
const APP_CONFIG = 'assets/raw/keplerscript-app-config.json'
const capture = { file: '/tmp/tmp.XXXXHeBy6l', pid: 2056 }
const player = assertAppId(PLAYER, { from: 'argument' })

// One target's app commands, by its shell prefix and `--device` value.
function commands(shell: string, device: string) {
  return {
    PKG_INFO: `${shell} vpm info ${PLAYER} --package`,
    VLCM: `${shell} vlcm list`,
    TERMINATE: `${shell} vlcm terminate-app --pkg-id ${PLAYER}`,
    CRASH_HISTORY: `${shell} vlcm crash-history`,
    START: `${shell} ${deviceScript(captureStartScript(CAPTURE_SECONDS))}`,
    LAUNCH: `vega device launch-app -a ${PLAYER}.main --device ${device}`,
    APP_LIST: `${shell} vlcm list --app-id ${PLAYER}.main`,
    LS: `${shell} loggingctl vault --ls SYSTEM_TOMBSTONE/acr`,
    acr: (index: number) => `${shell} ${deviceScript(acrScript(index))}`,
    stop: (crashPid: number) =>
      `${shell} ${deviceScript(captureStopScript(capture, player, crashPid))}`,
    install: (path: string) => `vega device install-app -p ${path} --device ${device}`
  }
}
const VVD = commands('vega exec vda -s emulator-5554 shell', 'VirtualDevice')
const STK = commands(`vega exec vda -s ${STICK} shell`, STICK)

const out = (path: string, exitCode = 0) => ({ stdout: fixture(`0.24/${path}`), exitCode })

// A stick and the Virtual Device online, the player installed and stopped on both (the
// Virtual Device's recordings stand in for the stick's app reads), and a launch it survives.
function launches(c: typeof VVD, history: string) {
  return {
    [c.PKG_INFO]: out('vpm-info-package/player.txt'),
    [c.VLCM]: out('vlcm-list/virtual-device-player-stopped.txt'),
    [c.CRASH_HISTORY]: out(history),
    [c.START]: out('log-capture/started.txt'),
    [c.LAUNCH]: out('vega-device-launch-app/launched.txt'),
    [c.APP_LIST]: out('vlcm-list/app-running.txt'),
    // A capture stopped after a launch that stayed up; a verified launch discards its lines.
    [c.stop(0)]: out('log-capture/virtual-device-verified.txt')
  }
}
const online = {
  'vega exec vda devices -l': out('vda-devices/stick-usb-and-virtual-device.txt'),
  'vega virtual-device status': out('vega-virtual-device-status/running.json'),
  [`vega device info --device ${STICK}`]: out('vega-device-info/stick-usb.json'),
  'vega device info --device VirtualDevice': out('vega-device-info/virtual-device.json'),
  ...launches(VVD, 'vlcm-crash-history/virtual-device-before.txt'),
  ...launches(STK, 'vlcm-crash-history/stick-empty.txt')
}
// The Virtual Device stopped: VDA lists only the stick.
const vvdStopped = {
  'vega exec vda devices -l': out('vda-devices/stick-usb.txt'),
  'vega virtual-device status': out('vega-virtual-device-status/stopped.json'),
  [`vega device info --device ${STICK}`]: out('vega-device-info/stick-usb.json')
}
// The Virtual Device player crashing right after launch, as recorded.
const crashes = {
  [VVD.CRASH_HISTORY]: [
    out('vlcm-crash-history/virtual-device-before.txt'),
    out('vlcm-crash-history/virtual-device-after.txt')
  ],
  [VVD.APP_LIST]: out('vlcm-list/app-missing.txt'),
  [VVD.LS]: out('loggingctl-vault-ls/virtual-device-tombstones-after.json'),
  [VVD.acr(37)]: out('loggingctl-vault-acr/virtual-device-crashed.txt'),
  [VVD.stop(3200)]: out('log-capture/virtual-device-crashed.txt')
}

// The recorded player packages (fixtures/0.24/README.md), by architecture and build type.
const RECORDED = {
  armv7: {
    info: 'vpt-info/player-armv7-release.json',
    contents: 'vpt-show-contents/player-armv7.txt',
    config: 'vpt-dump-app-config/release.json',
    checksum: 'vpt-checksum/player-armv7-release.txt'
  },
  aarch64: {
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

// What `react-native build-vega` writes (ARCHITECTURE §8), oldest first: the debug builds the
// Virtual Device runs and the release builds sticks run, newer ones of the other type.
const FOLDERS = ['aarch64-debug', 'armv7-release', 'aarch64-release', 'armv7-debug'] as const
type Folder = (typeof FOLDERS)[number]

let home: string
let project: string
let builds: Record<Folder, string>

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ovd-run-'))
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
  builds = made as Record<Folder, string>
  await writeFile(join(project, 'manifest.toml'), '[package]\nid = "com.example.player"\n')
  await writeFile(join(project, 'package.json'), '{}\n')
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

// Every build's `vpt` reads, by the architecture its folder names.
function allBuilds() {
  return Object.assign(
    {},
    ...FOLDERS.map((f) => vpt(builds[f], f.startsWith('armv7') ? 'armv7' : 'aarch64'))
  ) as Record<string, { stdout: string }>
}

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
  const projects = createProject({ state, homedir: home, cwd: home })
  await projects.open(project)
  const packages = createPackages({ runner, sdk, project: projects, homedir: home, cwd: home })
  const base = { runner, sdk, devices, packages, project: projects, homedir: home, cwd: home }
  const steps = createInstallSteps(base)
  const install = createInstall({ ...base, activity, steps })
  const apps = createApps({ ...base, activity, install: steps, sleep: vi.fn(async () => {}) })
  const run = createRun({ install, apps, steps, activity })
  const calls = () => runner.calls.map((c) => c.display)
  return { run, runner, calls }
}

// Runs with a `followLogs` that records how many SDK calls had run by then.
function options(calls: () => string[], over: Partial<RunOptions> = {}) {
  const steps: RunStep[] = []
  const followed: { target: string; app: string; callsBefore: number }[] = []
  const opts: RunOptions = {
    onStep: (s) => steps.push(s),
    followLogs: async (target, app) => {
      followed.push({ target: target.id, app, callsBefore: calls().length })
    },
    ...over
  }
  return { opts, steps, followed }
}

async function activity(): Promise<Partial<ActivityEntry>[]> {
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

async function failure(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error('expected a failure')
    },
    (error: Error) => error
  )
}

describe('run', () => {
  test('the Virtual Device: the aarch64 debug build, installed, followed, launched and verified', async () => {
    const { run, calls } = await setup({
      ...online,
      ...allBuilds(),
      [VVD.install(builds['aarch64-debug'])]: out('vega-device-install-app/installed.txt')
    })
    const { opts, steps, followed } = options(calls, { device: 'VirtualDevice' })

    const result = await run.run(undefined, opts)

    expect(result).toMatchObject({
      target: { id: 'VirtualDevice', architecture: 'aarch64' },
      package: {
        path: builds['aarch64-debug'],
        file: 'player_aarch64.vpkg',
        architecture: 'aarch64',
        buildType: 'debug',
        folder: 'build/aarch64-debug/'
      },
      forced: false,
      launch: { verified: true, pid: 3571, wasRunning: false, launched: true }
    })
    expect(steps.map((s) => s.step)).toEqual([
      'build',
      'install',
      'logs',
      'launch',
      'verify',
      'follow'
    ])
    expect(steps[0]).toMatchObject({ package: { folder: 'build/aarch64-debug/' } })
    // The log follows the target once the install is done, before the launch.
    const installAt = calls().indexOf(VVD.install(builds['aarch64-debug']))
    expect(followed).toEqual([{ target: 'VirtualDevice', app: PLAYER, callsBefore: installAt + 1 }])
    expect(calls().indexOf(VVD.LAUNCH)).toBeGreaterThan(installAt)
    expect(await activity()).toEqual([
      {
        action: 'app.install',
        target: 'VirtualDevice',
        args: { package: 'player_aarch64.vpkg' },
        result: 'ok'
      },
      { action: 'app.restart', target: 'VirtualDevice', args: { app: PLAYER }, result: 'ok' }
    ])
  })

  test('a stick: the armv7 release build over a newer debug one', async () => {
    const { run, calls } = await setup({
      ...online,
      ...allBuilds(),
      [STK.install(builds['armv7-release'])]: out('vega-device-install-app/installed.txt')
    })
    const { opts } = options(calls, { device: STICK })

    const result = await run.run(undefined, opts)

    expect(result.package).toMatchObject({ path: builds['armv7-release'], buildType: 'release' })
    expect(result.launch.verified).toBe(true)
  })

  test('without a build of the preferred type: the newest one that matches', async () => {
    await rm(builds['aarch64-debug'])
    const { run, calls } = await setup({
      ...online,
      ...allBuilds(),
      [VVD.install(builds['aarch64-release'])]: out('vega-device-install-app/installed.txt')
    })

    const result = await run.run(undefined, options(calls, { device: 'VirtualDevice' }).opts)

    expect(result.package.path).toBe(builds['aarch64-release'])
  })

  test('an explicit .vpkg is installed as it is', async () => {
    const { run, calls } = await setup({
      ...online,
      ...allBuilds(),
      [VVD.install(builds['aarch64-release'])]: out('vega-device-install-app/installed.txt')
    })

    const result = await run.run(
      builds['aarch64-release'],
      options(calls, { device: 'VirtualDevice' }).opts
    )

    expect(result.package).toMatchObject({ path: builds['aarch64-release'] })
    expect(result.package).not.toHaveProperty('folder')
  })

  test('an app still running after the install is stopped gracefully, then launched', async () => {
    const { run, calls } = await setup({
      ...online,
      ...allBuilds(),
      [VVD.install(builds['aarch64-debug'])]: out('vega-device-install-app/installed.txt'),
      [VVD.VLCM]: out('vlcm-list/virtual-device-player-running.txt'),
      [VVD.TERMINATE]: out('vlcm-terminate-app/stopped.txt')
    })

    const result = await run.run(undefined, options(calls, { device: 'VirtualDevice' }).opts)

    expect(result.launch).toMatchObject({ wasRunning: true, verified: true })
    expect(calls().indexOf(VVD.TERMINATE)).toBeLessThan(calls().indexOf(VVD.LAUNCH))
  })

  test('a crash on launch is returned unverified, with its cause, and no follow step', async () => {
    const { run, calls } = await setup({
      ...online,
      ...allBuilds(),
      ...crashes,
      [VVD.install(builds['aarch64-debug'])]: out('vega-device-install-app/installed.txt')
    })
    const { opts, steps } = options(calls, { device: 'VirtualDevice' })

    const result = await run.run(undefined, opts)

    expect(result.launch).toMatchObject({
      verified: false,
      reason: 'crashed',
      crash: { pid: 3200, signal: 'SIGABRT' }
    })
    expect(steps.map((s) => s.step)).not.toContain('follow')
    expect(await activity()).toMatchObject([
      { action: 'app.install', result: 'ok' },
      { action: 'app.restart', result: 'error', errorCode: 'LAUNCH_NOT_VERIFIED' }
    ])
  })

  test('an offline target: TARGET_OFFLINE, nothing installed, one install entry', async () => {
    const { run, calls } = await setup(vvdStopped)
    const { opts, steps, followed } = options(calls, { device: 'VirtualDevice' })

    const error = (await failure(run.run(undefined, opts))) as OvdError

    expect(error.code).toBe('TARGET_OFFLINE')
    expect(calls().some((c) => c.includes('install-app') || c.includes('vpt'))).toBe(false)
    expect(steps).toEqual([])
    expect(followed).toEqual([])
    expect(await activity()).toEqual([
      {
        action: 'app.install',
        target: null,
        args: {},
        result: 'error',
        errorCode: 'TARGET_OFFLINE'
      }
    ])
  })

  test('an architecture mismatch: ARCH_MISMATCH, nothing installed or launched', async () => {
    const { run, calls } = await setup({ ...online, ...allBuilds() })
    const { opts, followed } = options(calls, { device: STICK })

    const error = (await failure(run.run(builds['aarch64-debug'], opts))) as OvdError

    expect(error.code).toBe('ARCH_MISMATCH')
    expect(calls().some((c) => c.includes('install-app') || c.includes('launch-app'))).toBe(false)
    expect(followed).toEqual([])
  })

  test('an abort while the log starts stops the run before the launch', async () => {
    const controller = new AbortController()
    const { run, calls } = await setup({
      ...online,
      ...allBuilds(),
      [VVD.install(builds['aarch64-debug'])]: out('vega-device-install-app/installed.txt')
    })
    const { opts, steps } = options(calls, {
      device: 'VirtualDevice',
      signal: controller.signal,
      followLogs: async () => controller.abort()
    })

    const error = await failure(run.run(undefined, opts))

    expect(error.name).toBe('AbortError')
    expect(calls()).not.toContain(VVD.LAUNCH)
    expect(steps.map((s) => s.step)).toEqual(['build', 'install', 'logs'])
  })

  test('an abort before the run starts reads nothing', async () => {
    const { run, calls } = await setup(online)
    const controller = new AbortController()
    controller.abort()

    const error = await failure(
      run.run(undefined, options(calls, { signal: controller.signal }).opts)
    )

    expect(error.name).toBe('AbortError')
    expect(calls()).toEqual([])
  })
})

describe('preferredBuildType', () => {
  test.each([
    ['vvd', 'debug'],
    ['stick', 'release']
  ] as const)('%s: %s', (kind, type) => {
    expect(preferredBuildType({ kind })).toBe(type)
  })
})
