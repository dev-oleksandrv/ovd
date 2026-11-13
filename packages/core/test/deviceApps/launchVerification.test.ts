import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
  launchNotVerified,
  OvdError,
  type ActivityEntry,
  type LaunchCrash
} from '../../src/index.js'
import { assertAppId } from '../../src/deviceApps/appId.js'
import {
  acrScript,
  captureStartScript,
  captureStopScript,
  deviceScript
} from '../../src/deviceApps/launchScripts.js'
import {
  CAPTURE_SECONDS,
  LAUNCH_TIMEOUT_MS,
  SETTLE_MS
} from '../../src/deviceApps/launchVerification.js'
import { launchReportedCrashes } from '../../src/crashes/crashList.js'
import { createInstallSteps } from '../../src/install/installSteps.js'
import { FakeRunner } from '../support/fakeRunner.js'
import { fixture } from '../support/fixtures.js'

const STICK = 'G070000000000001'
const PLAYER = 'com.example.player'
const player = assertAppId(PLAYER, { from: 'argument' })
const capture = { file: '/tmp/tmp.XXXXHeBy6l', pid: 2056 }

// The commands of one target, by the shell prefix and the `--device` value.
function commands(shell: string, device: string) {
  return {
    PKG_INFO: `${shell} vpm info ${PLAYER} --package`,
    VLCM: `${shell} vlcm list`,
    CRASH_HISTORY: `${shell} vlcm crash-history`,
    START: `${shell} ${deviceScript(captureStartScript(CAPTURE_SECONDS))}`,
    LAUNCH: `vega device launch-app -a ${PLAYER}.main --device ${device}`,
    APP_LIST: `${shell} vlcm list --app-id ${PLAYER}.main`,
    LS: `${shell} loggingctl vault --ls SYSTEM_TOMBSTONE/acr`,
    acr: (index: number) => `${shell} ${deviceScript(acrScript(index))}`,
    stop: (crashPid: number) =>
      `${shell} ${deviceScript(captureStopScript(capture, player, crashPid))}`
  }
}
const VVD = commands('vega exec vda -s emulator-5554 shell', 'VirtualDevice')
const STK = commands(`vega exec vda -s ${STICK} shell`, STICK)

const out = (path: string, exitCode = 0) => ({ stdout: fixture(`0.24/${path}`), exitCode })
const lines = (path: string) =>
  fixture(`0.24/${path}`)
    .split('\n')
    .filter((l) => l.trim() !== '')

// A stick and the Virtual Device, both online; both have the player (the Virtual Device's
// `vpm info` recording stands in for the stick's).
const online = {
  'vega exec vda devices -l': out('vda-devices/stick-usb-and-virtual-device.txt'),
  'vega virtual-device status': out('vega-virtual-device-status/running.json'),
  [`vega device info --device ${STICK}`]: out('vega-device-info/stick-usb.json'),
  'vega device info --device VirtualDevice': out('vega-device-info/virtual-device.json'),
  [VVD.PKG_INFO]: out('vpm-info-package/player.txt'),
  [STK.PKG_INFO]: out('vpm-info-package/player.txt'),
  [VVD.START]: out('log-capture/started.txt'),
  [STK.START]: out('log-capture/started.txt'),
  [VVD.LAUNCH]: out('vega-device-launch-app/launched.txt'),
  [STK.LAUNCH]: out('vega-device-launch-app/launched.txt'),
  // A capture stopped after a launch that stayed up; the Virtual Device's recording stands in
  // for the stick's. A verified launch discards these lines.
  [VVD.stop(0)]: out('log-capture/virtual-device-verified.txt'),
  [STK.stop(0)]: out('log-capture/virtual-device-verified.txt')
}

// The Virtual Device player that survives its launch: stopped at the read before the launch,
// running at the polls.
const survives = {
  ...online,
  [VVD.CRASH_HISTORY]: out('vlcm-crash-history/virtual-device-before.txt'),
  [VVD.APP_LIST]: [out('vlcm-list/app-missing.txt'), out('vlcm-list/app-running.txt')]
}

// The Virtual Device player that crashes right after launch, as recorded.
const crashes = {
  ...online,
  [VVD.CRASH_HISTORY]: [
    out('vlcm-crash-history/virtual-device-before.txt'),
    out('vlcm-crash-history/virtual-device-after.txt')
  ],
  [VVD.APP_LIST]: out('vlcm-list/app-missing.txt'),
  [VVD.LS]: out('loggingctl-vault-ls/virtual-device-tombstones-after.json'),
  [VVD.acr(37)]: out('loggingctl-vault-acr/virtual-device-crashed.txt'),
  [VVD.stop(3200)]: out('log-capture/virtual-device-crashed.txt')
}

const DEVICE = { device: 'VirtualDevice' }

let home: string
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ovd-launch-verification-'))
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

function setup(script: ConstructorParameters<typeof FakeRunner>[0]) {
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
  const sleep = vi.fn(async (_ms: number) => {})
  const apps = createApps({
    runner,
    sdk,
    devices,
    project,
    packages,
    activity,
    install,
    homedir: home,
    cwd: home,
    sleep
  })
  const calls = () => runner.calls.map((c) => c.display)
  return { apps, runner, sleep, calls }
}

async function activity(): Promise<Partial<ActivityEntry>[]> {
  const text = await readFile(join(home, '.config', 'ovd', 'activity.jsonl'), 'utf8').catch(
    () => ''
  )
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const { action, args, result, errorCode } = JSON.parse(l) as ActivityEntry
      return { action, args, result, ...(errorCode ? { errorCode } : {}) }
    })
}

// The script a `… shell echo <base64> | base64 -d | sh` call ran.
function decoded(display: string): string | undefined {
  const m = / shell echo ([A-Za-z0-9+/=]+) \| base64 -d \| sh$/.exec(display)
  return m?.[1] === undefined ? undefined : Buffer.from(m[1], 'base64').toString()
}

function crashOf(result: { verified: boolean }): LaunchCrash {
  if (!('crash' in result)) throw new Error('expected a crash')
  return (result as { crash: LaunchCrash }).crash
}

describe('launch verification', () => {
  test('verified on the Virtual Device: the pid, five polls, the capture stopped', async () => {
    const { apps, sleep, calls } = setup(survives)

    const result = await apps.launch(PLAYER, DEVICE)

    expect(result).toMatchObject({ launched: true, wasRunning: false, verified: true, pid: 3571 })
    expect(result).not.toHaveProperty('crash')
    // The stop printed the launch's lines (log-capture/virtual-device-verified.txt); none is kept.
    expect(JSON.stringify(result)).not.toContain('lcm_service')
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 1000, 1000, 1000, 1000])
    expect(calls()).toContain(VVD.stop(0))
    // The read before the launch, then the five polls.
    expect(calls().filter((c) => c === VVD.APP_LIST)).toHaveLength(6)
    expect(await activity()).toEqual([
      { action: 'app.launch', args: { app: PLAYER }, result: 'ok' }
    ])
  })

  test('crashed on the Virtual Device: the crash, its cause and the logs around it', async () => {
    const { apps, runner, calls } = setup(crashes)

    const result = await apps.launch(PLAYER, DEVICE)

    expect(result).toMatchObject({
      launched: true,
      wasRunning: false,
      verified: false,
      reason: 'crashed'
    })
    expect(crashOf(result)).toEqual({
      pid: 3200,
      time: '2026-11-08T01:51:44.657Z',
      // The vault index `ovd crashes` and `ovd crash pull` take.
      id: 37,
      signal: 'SIGABRT',
      language: 'JavaScript',
      message: 'Error: player: deliberate crash right after launch',
      stack: [expect.stringMatching(/^at anonymous \(/)],
      logs: lines('log-capture/virtual-device-crashed.txt')
    })
    expect(await activity()).toEqual([
      {
        action: 'app.launch',
        args: { app: PLAYER, reason: 'crashed', pid: '3200', signal: 'SIGABRT' },
        result: 'error',
        errorCode: 'LAUNCH_NOT_VERIFIED'
      }
    ])
    const order = [VVD.LAUNCH, VVD.LS, VVD.acr(37), VVD.stop(3200)].map((c) => calls().indexOf(c))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order.every((i) => i >= 0)).toBe(true)
    const stop = runner.calls.map((c) => decoded(c.display)).find((s) => s?.startsWith('pkill'))
    expect(stop).toContain(String.raw`'\[3200\]'`)
  })

  test('a crashed launch notes its vault index, so the crash watcher stays quiet about it', async () => {
    const { apps } = setup(crashes)

    await apps.launch(PLAYER, DEVICE)

    expect(launchReportedCrashes.has('VirtualDevice', 37)).toBe(true)
    expect(launchReportedCrashes.has(STICK, 37)).toBe(false)
  })

  test('the package is held for the crash watcher while the launch is verified, then released', async () => {
    const { apps, sleep } = setup(crashes)
    const heldAt: boolean[] = []
    sleep.mockImplementation(async () => {
      heldAt.push(launchReportedCrashes.isHeld('VirtualDevice', PLAYER))
    })
    expect(launchReportedCrashes.isHeld('VirtualDevice', PLAYER)).toBe(false)

    await apps.launch(PLAYER, DEVICE)

    expect(heldAt.length).toBeGreaterThan(0)
    expect(heldAt.every(Boolean)).toBe(true)
    expect(launchReportedCrashes.isHeld('VirtualDevice', PLAYER)).toBe(false)
  })

  test('the hold is released when the launch fails', async () => {
    const { apps } = setup({ ...survives, [VVD.LAUNCH]: { stderr: 'boom\n', exitCode: 1 } })

    await expect(apps.launch(PLAYER, DEVICE)).rejects.toMatchObject({ code: 'LAUNCH_FAILED' })

    expect(launchReportedCrashes.isHeld('VirtualDevice', PLAYER)).toBe(false)
  })

  test('crashed on the stick: IDLE, READY, then gone, and the new crash entry', async () => {
    const { apps } = setup({
      ...online,
      [STK.CRASH_HISTORY]: [
        out('vlcm-crash-history/stick-one.txt'),
        out('vlcm-crash-history/stick-two.txt')
      ],
      [STK.APP_LIST]: [
        // The read before the launch, then the recorded polls.
        out('vlcm-list/app-missing.txt'),
        out('vlcm-list/app-idle.txt'),
        out('vlcm-list/app-ready.txt'),
        out('vlcm-list/app-missing.txt')
      ],
      [STK.LS]: out('loggingctl-vault-ls/stick-tombstones.json'),
      [STK.acr(2085)]: out('loggingctl-vault-acr/stick-crashed.txt'),
      [STK.stop(20609)]: out('log-capture/stick-crashed.txt')
    })

    const result = await apps.launch(PLAYER, { device: STICK })

    expect(crashOf(result)).toMatchObject({
      pid: 20609,
      id: 2085,
      time: '2026-11-07T22:36:50.802Z',
      signal: 'SIGABRT',
      language: 'JavaScript',
      logs: lines('log-capture/stick-crashed.txt')
    })
  })

  test('the crash report enrolls late: read again after 500 ms', async () => {
    const { apps, runner, sleep } = setup({
      ...crashes,
      [VVD.LS]: [
        out('loggingctl-vault-ls/virtual-device-tombstones-before.json'),
        out('loggingctl-vault-ls/virtual-device-tombstones-after.json')
      ]
    })

    const result = await apps.launch(PLAYER, DEVICE)

    expect(crashOf(result).signal).toBe('SIGABRT')
    expect(runner.count(VVD.LS)).toBe(2)
    expect(sleep.mock.calls.filter(([ms]) => ms === 500)).toHaveLength(1)
  })

  test('no crash report: still crashed, without a cause', async () => {
    const { apps, runner } = setup({
      ...crashes,
      [VVD.LS]: out('loggingctl-vault-ls/virtual-device-tombstones-before.json')
    })

    const crash = crashOf(await apps.launch(PLAYER, DEVICE))

    expect(crash).not.toHaveProperty('signal')
    expect(crash).not.toHaveProperty('language')
    expect(crash.stack).toEqual([])
    expect(runner.count(VVD.LS)).toBe(3)
    expect(runner.count(VVD.acr(37))).toBe(0)
  })

  test('the crash report is refused: the signal from its file name, no message', async () => {
    const { apps } = setup({
      ...crashes,
      [VVD.acr(37)]: out('loggingctl-vault-acr/insufficient-permissions.json')
    })

    const crash = crashOf(await apps.launch(PLAYER, DEVICE))

    expect(crash.signal).toBe('SIGABRT')
    expect(crash).not.toHaveProperty('message')
    expect(crash).not.toHaveProperty('language')
  })

  test('only IDLE with pid 0 and no new crash: not running, after one more read', async () => {
    const { apps, runner, sleep } = setup({
      ...online,
      [STK.CRASH_HISTORY]: out('vlcm-crash-history/stick-one.txt'),
      [STK.APP_LIST]: out('vlcm-list/app-idle.txt')
    })

    const result = await apps.launch(PLAYER, { device: STICK })

    expect(result).toMatchObject({ verified: false, reason: 'not-running' })
    expect(result).not.toHaveProperty('crash')
    expect(runner.count(STK.CRASH_HISTORY)).toBe(3)
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 1000, 1000, 1000, 1000, 1000])
    expect(await activity()).toEqual([
      {
        action: 'app.launch',
        args: { app: PLAYER, reason: 'not-running' },
        result: 'error',
        errorCode: 'LAUNCH_NOT_VERIFIED'
      }
    ])
  })

  test('the one more read finds the crash: crashed', async () => {
    const { apps } = setup({
      ...crashes,
      [VVD.CRASH_HISTORY]: [
        out('vlcm-crash-history/virtual-device-before.txt'),
        out('vlcm-crash-history/virtual-device-before.txt'),
        out('vlcm-crash-history/virtual-device-after.txt')
      ]
    })

    expect(await apps.launch(PLAYER, DEVICE)).toMatchObject({ reason: 'crashed' })
  })

  test.each([
    ['fails', { stdout: '', exitCode: 1 }],
    ['prints something else', { stdout: '/tmp/../x 1\n' }]
  ])('the capture %s: still verified, and nothing to stop', async (_name, start) => {
    const { apps, calls } = setup({ ...survives, [VVD.START]: start })

    expect(await apps.launch(PLAYER, DEVICE)).toMatchObject({ verified: true, pid: 3571 })
    expect(calls().some((c) => decoded(c)?.startsWith('pkill'))).toBe(false)
  })

  test('control characters in the captured lines are removed, a tab kept', async () => {
    const recorded = fixture('0.24/log-capture/virtual-device-crashed.txt')
    const logged =
      'com.example.player[3200]: I\tjs: \u001b]0;pwned\u0007\u001b[31mred\u009b2J\u0000'
    const { apps } = setup({
      ...crashes,
      [VVD.stop(3200)]: { stdout: `${recorded}${logged}\r\n\u001b\n`, exitCode: 0 }
    })

    const { logs } = crashOf(await apps.launch(PLAYER, DEVICE))

    expect(logs).toEqual([
      ...lines('log-capture/virtual-device-crashed.txt'),
      'com.example.player[3200]: I\tjs: ]0;pwned[31mred2J'
    ])
  })

  test('no capture and a crash: the crash without logs', async () => {
    const { apps } = setup({ ...crashes, [VVD.START]: { stdout: '', exitCode: 1 } })

    expect(crashOf(await apps.launch(PLAYER, DEVICE)).logs).toEqual([])
  })

  test('launch-app fails: LAUNCH_FAILED, and the capture is stopped', async () => {
    const { apps, runner } = setup({ ...survives, [VVD.LAUNCH]: { stderr: 'boom\n', exitCode: 1 } })

    await expect(apps.launch(PLAYER, DEVICE)).rejects.toMatchObject({ code: 'LAUNCH_FAILED' })
    expect(runner.count(VVD.stop(0))).toBe(1)
    // Only the read before the launch: no poll.
    expect(runner.count(VVD.APP_LIST)).toBe(1)
  })

  test('the second crash-history read is garbage: UNEXPECTED_OUTPUT, the capture stopped', async () => {
    const { apps, runner } = setup({
      ...survives,
      [VVD.CRASH_HISTORY]: [
        out('vlcm-crash-history/virtual-device-before.txt'),
        { stdout: 'garbage\n' }
      ]
    })

    await expect(apps.launch(PLAYER, DEVICE)).rejects.toMatchObject({ code: 'UNEXPECTED_OUTPUT' })
    expect(runner.count(VVD.stop(0))).toBe(1)
    expect(await activity()).toMatchObject([{ result: 'error', errorCode: 'UNEXPECTED_OUTPUT' }])
  })

  test('the cause and the logs fail: still crashed, without them', async () => {
    const offline = new OvdError('TARGET_OFFLINE', 'Vega Virtual Device is offline', 'Retry')
    const { apps } = setup({ ...crashes, [VVD.LS]: offline, [VVD.stop(3200)]: offline })

    const crash = crashOf(await apps.launch(PLAYER, DEVICE))

    expect(crash).toMatchObject({ pid: 3200, stack: [], logs: [] })
    expect(crash).not.toHaveProperty('signal')
  })

  test('onVerifying: once, after launch-app and before the first poll', async () => {
    const { apps, runner, calls } = setup(survives)
    const seen: number[] = []

    await apps.launch(PLAYER, { ...DEVICE, onVerifying: () => seen.push(runner.calls.length) })

    expect(seen).toHaveLength(1)
    const at = seen[0] ?? -1
    expect(calls()[at - 1]).toBe(VVD.LAUNCH)
    expect(calls()[at]).toBe(VVD.APP_LIST)
  })

  test('a restart that crashes: not verified, logged as app.restart', async () => {
    const { apps } = setup({
      ...crashes,
      [VVD.VLCM]: out('vlcm-list/virtual-device-player-stopped.txt')
    })

    const result = await apps.restart(PLAYER, DEVICE)

    expect(result).toMatchObject({ wasRunning: false, verified: false, reason: 'crashed' })
    expect(await activity()).toMatchObject([
      { action: 'app.restart', result: 'error', errorCode: 'LAUNCH_NOT_VERIFIED' }
    ])
  })

  test('the capture outlives the launch timeout and the settle window', async () => {
    const { apps, runner } = setup(survives)

    await apps.launch(PLAYER, DEVICE)

    const start = runner.calls.map((c) => decoded(c.display)).find((s) => s?.startsWith('f='))
    expect(start).toContain('timeout 200 loggingctl')
    expect(CAPTURE_SECONDS * 1000).toBeGreaterThanOrEqual(LAUNCH_TIMEOUT_MS + SETTLE_MS)
  })
})

describe('launchNotVerified', () => {
  const crash = { pid: 3200, time: '2026-11-08T01:51:44.657Z', stack: [], logs: [] }

  test.each([
    [
      'crashed',
      { verified: false, reason: 'crashed', crash } as const,
      'Launch reported success, but the app crashed',
      'See the cause and the logs around the crash, then launch it again'
    ],
    [
      'not running',
      { verified: false, reason: 'not-running' } as const,
      'Launch reported success, but the app isn’t running',
      'Check the app with ovd apps info, then launch it again'
    ]
  ])('%s', (_name, result, message, hint) => {
    expect(launchNotVerified(result)).toMatchObject({ code: 'LAUNCH_NOT_VERIFIED', message, hint })
  })

  test('verified: none', () => {
    expect(launchNotVerified({ verified: true, pid: 3571 })).toBeUndefined()
  })
})
