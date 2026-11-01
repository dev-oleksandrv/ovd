import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  createActivityLog,
  createDevices,
  createInstall,
  createPackages,
  createProject,
  createSdkLocator,
  createStateStore,
  type ActivityEntry,
  type OvdError
} from '../../src/index.js'
import { FakeRunner } from '../support/fakeRunner.js'
import { fixture } from '../support/fixtures.js'

const STICK = 'G070000000000001'
const VDA = 'vega exec vda devices -l'
const STATUS = 'vega virtual-device status'
const STICK_INFO = `vega device info --device ${STICK}`
const VVD_INFO = 'vega device info --device VirtualDevice'
const APP_CONFIG = 'assets/raw/keplerscript-app-config.json'

const out = (path: string) => ({ stdout: fixture(`0.24/${path}`) })
const err = (path: string, exitCode: number) => ({ stderr: fixture(`0.24/${path}`), exitCode })

// The recorded sample packages (fixtures/0.24/README.md), by what `vpt` printed for each.
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
  },
  hellovega: {
    info: 'vpt-info/hellovega-armv7-release.json',
    contents: 'vpt-show-contents/hellovega.txt',
    config: 'vpt-dump-app-config/hellovega-release.json',
    checksum: 'vpt-checksum/hellovega-armv7-release.txt'
  }
} as const
type Recorded = keyof typeof RECORDED

function vpt(path: string, name: Recorded) {
  const r = RECORDED[name]
  return {
    [`vega exec vpt info --json ${path}`]: out(r.info),
    [`vega exec vpt show-contents ${path}`]: out(r.contents),
    [`vega exec vpt dump ${path} ${APP_CONFIG}`]: out(r.config),
    [`vega exec vpt checksum ${path}`]: out(r.checksum)
  }
}

const installCmd = (path: string, device: string) =>
  `vega device install-app -p ${path} --device ${device}`

// A stick (armv7) and the Virtual Device (aarch64), both online.
const bothOnline = {
  [VDA]: out('vda-devices/stick-usb-and-virtual-device.txt'),
  [STATUS]: out('vega-virtual-device-status/running.json'),
  [STICK_INFO]: out('vega-device-info/stick-usb.json'),
  [VVD_INFO]: out('vega-device-info/virtual-device.json')
}

let home: string
let project: string
let armv7: string
let aarch64: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ovd-install-'))
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
  const install = createInstall({ runner, sdk, devices, packages, activity })
  return { install, devices, runner }
}

async function activity(): Promise<Pick<ActivityEntry, 'action' | 'result' | 'errorCode'>[]> {
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

describe('Install.install', () => {
  test('installs a package that matches the target', async () => {
    const { install, runner } = await setup({
      ...bothOnline,
      ...vpt(armv7, 'player-armv7'),
      [installCmd(armv7, STICK)]: out('vega-device-install-app/installed.txt')
    })

    const result = await install.install(armv7, { device: STICK })

    expect(result).toEqual({
      installed: true,
      package: {
        path: armv7,
        displayPath: '~/dev/player/build/armv7-release/player_armv7.vpkg',
        file: 'player_armv7.vpkg',
        id: 'com.example.player',
        title: 'Sample Player',
        version: '1.4.2',
        buildNumber: 142,
        architecture: 'armv7'
      },
      target: { id: STICK, name: 'Fire TV stick', architecture: 'armv7' },
      forced: false
    })
    expect(runner.count(installCmd(armv7, STICK))).toBe(1)
    expect(await activity()).toEqual([
      {
        action: 'app.install',
        target: STICK,
        args: { package: 'player_armv7.vpkg' },
        result: 'ok'
      }
    ])
  })

  test('blocks a package for another architecture and offers the matching build', async () => {
    const { install, runner } = await setup({
      ...bothOnline,
      ...vpt(aarch64, 'player-aarch64'),
      ...vpt(armv7, 'player-armv7')
    })

    const error = await failure(install.install(aarch64, { device: STICK }))

    expect(error).toMatchObject({
      code: 'ARCH_MISMATCH',
      message: 'Architecture mismatch: package is aarch64, Fire TV stick is armv7',
      hint:
        'Install the armv7 build instead: ovd install ~/dev/player/build/armv7-release/player_armv7.vpkg. ' +
        'Or pass --force to install anyway',
      details: { package: 'aarch64', target: 'armv7', fix: armv7 }
    })
    expect(runner.calls.some((c) => c.args.includes('install-app'))).toBe(false)
    expect(await activity()).toEqual([
      {
        action: 'app.install',
        target: STICK,
        args: { package: 'player_aarch64.vpkg' },
        result: 'error',
        errorCode: 'ARCH_MISMATCH'
      }
    ])
  })

  test('without a matching build, the hint says to build one or switch the target', async () => {
    await rm(armv7)
    const { install } = await setup({ ...bothOnline, ...vpt(aarch64, 'player-aarch64') })

    const error = await failure(install.install(aarch64, { device: STICK }))

    expect(error.code).toBe('ARCH_MISMATCH')
    expect(error.hint).toBe(
      'Build the app for armv7 or switch the target. Or pass --force to install anyway'
    )
  })

  test('--force installs a mismatched package and says so', async () => {
    const { install, runner } = await setup({
      ...bothOnline,
      ...vpt(aarch64, 'player-aarch64'),
      ...vpt(armv7, 'player-armv7'),
      [installCmd(aarch64, STICK)]: out('vega-device-install-app/installed-wrong-arch.txt')
    })

    const result = await install.install(aarch64, { device: STICK, force: true })

    expect(result).toMatchObject({ installed: true, forced: true })
    expect(runner.count(installCmd(aarch64, STICK))).toBe(1)
    expect(await activity()).toMatchObject([
      { args: { package: 'player_aarch64.vpkg', force: 'true' }, result: 'ok' }
    ])
  })

  test('a pure-JS package installs on any architecture', async () => {
    const pure = await makeFile('build/hellovega.vpkg', new Date('2026-11-01T12:00:00Z'))
    const { install } = await setup({
      ...bothOnline,
      ...vpt(pure, 'hellovega'),
      [installCmd(pure, 'VirtualDevice')]: out('vega-device-install-app/installed.txt')
    })

    const result = await install.install(pure, { device: 'VirtualDevice' })

    expect(result).toMatchObject({
      installed: true,
      forced: false,
      package: { architecture: 'any' },
      target: { id: 'VirtualDevice', architecture: 'aarch64' }
    })
  })

  test('installs on the remembered target', async () => {
    const { install, devices } = await setup({
      ...bothOnline,
      ...vpt(aarch64, 'player-aarch64'),
      [installCmd(aarch64, 'VirtualDevice')]: out('vega-device-install-app/installed.txt')
    })
    await devices.setTarget('VirtualDevice')

    const result = await install.install(aarch64)

    expect(result.target.id).toBe('VirtualDevice')
  })

  test('without a target, fails before reading the package', async () => {
    const { install, runner } = await setup(bothOnline)

    const error = await failure(install.install(armv7))

    expect(error.code).toBe('NO_TARGET')
    expect(runner.calls.some((c) => c.args.includes('vpt'))).toBe(false)
  })

  test('a stopped Virtual Device is offline', async () => {
    const { install } = await setup({
      [VDA]: out('vda-devices/stick-usb.txt'),
      [STATUS]: out('vega-virtual-device-status/stopped.json'),
      [STICK_INFO]: out('vega-device-info/stick-usb.json')
    })

    const error = await failure(install.install(aarch64, { device: 'VirtualDevice' }))

    expect(error).toMatchObject({
      code: 'TARGET_OFFLINE',
      message: 'Vega Virtual Device is stopped',
      hint: 'Start it with ovd vvd start'
    })
  })

  test('reports what the device said when the install fails', async () => {
    const { install } = await setup({
      ...bothOnline,
      ...vpt(aarch64, 'player-aarch64'),
      [installCmd(aarch64, 'VirtualDevice')]: err(
        'vega-device-install-app/missing-dependency.stderr.txt',
        1
      )
    })

    const error = await failure(install.install(aarch64, { device: 'VirtualDevice' }))

    expect(error).toMatchObject({
      code: 'INSTALL_FAILED',
      message:
        "Install failed: Unable to install '/tmp/player_aarch64.vpkg' as the required dependencies are not found on the device.",
      hint: expect.stringContaining('The Virtual Device lacks some that sticks have')
    })
    expect(await activity()).toMatchObject([{ result: 'error', errorCode: 'INSTALL_FAILED' }])
  })

  test('a device the SDK can no longer find is offline', async () => {
    const { install } = await setup({
      ...bothOnline,
      ...vpt(armv7, 'player-armv7'),
      [installCmd(armv7, STICK)]: err('vega-device-install-app/device-not-found.stderr.txt', 2)
    })

    const error = await failure(install.install(armv7, { device: STICK }))

    expect(error.code).toBe('TARGET_OFFLINE')
  })
})

describe('Install.check', () => {
  test('allows a matching package without looking for a fix', async () => {
    const { install, runner } = await setup({ ...bothOnline, ...vpt(armv7, 'player-armv7') })

    const check = await install.check(armv7, { device: STICK })

    expect(check).toEqual({
      allowed: true,
      verdict: 'match',
      package: { path: armv7, architecture: 'armv7' },
      target: { id: STICK, name: 'Fire TV stick', architecture: 'armv7' }
    })
    expect(runner.calls.filter((c) => c.args.includes('vpt'))).toHaveLength(1)
  })

  test('blocks a mismatch and names the newest matching build', async () => {
    const { install } = await setup({
      ...bothOnline,
      ...vpt(aarch64, 'player-aarch64'),
      ...vpt(armv7, 'player-armv7')
    })

    const check = await install.check(aarch64, { device: STICK })

    expect(check).toMatchObject({
      allowed: false,
      verdict: 'mismatch',
      package: { architecture: 'aarch64' },
      target: { architecture: 'armv7' },
      fix: { path: armv7, file: 'player_armv7.vpkg' }
    })
  })

  test('reads only builds whose folder matches the target or names no architecture', async () => {
    const x86 = await makeFile(
      'build/x86_64-release/player_x86_64.vpkg',
      new Date('2026-11-01T12:00:00Z')
    )
    const { install, runner } = await setup({
      ...bothOnline,
      ...vpt(armv7, 'player-armv7'),
      ...vpt(aarch64, 'player-aarch64')
    })

    const check = await install.check(armv7, { device: 'VirtualDevice' })

    expect(check).toMatchObject({ allowed: false, fix: { path: aarch64 } })
    expect(runner.calls.map((c) => c.display)).not.toContain(`vega exec vpt show-contents ${x86}`)
  })
})
