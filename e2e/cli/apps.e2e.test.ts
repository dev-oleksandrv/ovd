import type {
  AppDetails,
  AppList,
  LaunchResult,
  ReinstallResult,
  RestartResult,
  TerminateResult,
  UninstallResult
} from '@ovd/core'
import { describe, expect, test } from 'vitest'
import { ALL_PACKAGES } from '../fake-sdk/world.ts'
import { ovd } from '../harness/cli.ts'
import { MANIFEST, makeProject, makeRecordedVpkg } from '../harness/project.ts'
import { createSandbox, type Sandbox } from '../harness/vitest.ts'

const AARCH64 = 'dev/player/build/aarch64-debug/player_aarch64.vpkg'
const SHELL = 'vega exec vda -s emulator-5554 shell'
const ALL = `${SHELL} ${ALL_PACKAGES}`
const VLCM = `${SHELL} vlcm list`
const VVD = ['--device', 'VirtualDevice']
// The player's own manifest: the project the recorded player packages were built from.
const PLAYER_MANIFEST = MANIFEST.replaceAll('hellovega', 'player')

// The Virtual Device running, a player project with an aarch64 Debug build, opened.
async function withPlayerProject(): Promise<Sandbox> {
  const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
  sandbox.installSdk()
  makeProject(sandbox.home, 'player', { manifest: PLAYER_MANIFEST })
  makeRecordedVpkg(sandbox.home, AARCH64, 'player-aarch64-debug', new Date('2026-10-13T09:00:00Z'))
  expect((await ovd(sandbox, ['open', `${sandbox.home}/dev/player`])).exitCode).toBe(0)
  return sandbox
}

const appCalls = (sandbox: Sandbox): string[] => sandbox.calls().filter((c) => c.startsWith(SHELL))

describe('ovd apps', () => {
  test('install, then list: the player shows up stopped, then running once it runs', async () => {
    const sandbox = await withPlayerProject()

    const install = await ovd(sandbox, ['apps', 'install', `~/${AARCH64}`, ...VVD, '--json'])
    expect(install.exitCode).toBe(0)

    const listed = await ovd(sandbox, ['apps', ...VVD, '--json'])
    expect(listed.exitCode).toBe(0)
    const list = listed.json<{ ok: true } & AppList>()
    expect(list.target).toEqual({ id: 'VirtualDevice', name: 'Vega Virtual Device' })
    expect(list.apps).toEqual([
      expect.objectContaining({
        packageId: 'com.example.player',
        source: 'sideloaded',
        status: { state: 'stopped' },
        components: [{ id: 'com.example.player.main' }]
      })
    ])
    // One round trip for every package, one for what runs.
    expect(appCalls(sandbox)).toEqual([ALL, VLCM])

    // Started outside OVD.
    sandbox.update((w) => {
      w.running.push({ device: 'VirtualDevice', app: 'com.example.player' })
    })
    const running = await ovd(sandbox, ['apps', '--running', ...VVD, '--json'])
    expect(running.json<{ ok: true } & AppList>().apps).toEqual([
      expect.objectContaining({
        packageId: 'com.example.player',
        status: { state: 'running', pid: expect.any(Number), lifespan: 'PERMANENT' }
      })
    ])
  })

  test('human output, and --all adds the system apps', async () => {
    const sandbox = await withPlayerProject()
    await ovd(sandbox, ['apps', 'install', `~/${AARCH64}`, ...VVD])

    const human = await ovd(sandbox, ['apps', ...VVD])
    expect(human.stdout).toMatch(
      /^Basic UI React Native Application for project player {2}com\.example\.player {2}0\.1\.0 \(1\) {2}Stopped\n$/
    )

    const all = await ovd(sandbox, ['apps', '--all', ...VVD, '--json'])
    const apps = all.json<{ ok: true } & AppList>().apps
    expect(apps[0]?.packageId).toBe('com.example.player')
    expect(apps.length).toBeGreaterThan(10)
    expect(apps.slice(1).every((a) => a.source === 'system')).toBe(true)
  })

  test('nothing installed', async () => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['apps', ...VVD])

    expect(run.exitCode).toBe(0)
    expect(run.stdout).toBe('No apps you installed on Vega Virtual Device.\n')
    expect(run.stderr).toContain('ovd apps install')
  })

  test('a stopped Virtual Device exits 4 without asking it anything', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()

    const run = await ovd(sandbox, ['apps', ...VVD, '--json'])

    expect(run.exitCode).toBe(4)
    expect(run.json<{ ok: false; error: { code: string } }>().error.code).toBe('TARGET_OFFLINE')
    expect(appCalls(sandbox)).toEqual([])
  })
})

describe('ovd apps info', () => {
  test('by component ID, by project folder and for the open project', async () => {
    const sandbox = await withPlayerProject()
    await ovd(sandbox, ['apps', 'install', `~/${AARCH64}`, ...VVD])

    for (const ref of [['com.example.player.main'], [`${sandbox.home}/dev/player`], []]) {
      const run = await ovd(sandbox, ['apps', 'info', ...ref, ...VVD, '--json'])
      expect(run.exitCode, `${ref.join(' ')}: ${run.stdout}`).toBe(0)
      expect(run.json<{ ok: true } & AppDetails>().app).toMatchObject({
        packageId: 'com.example.player',
        components: [
          { id: 'com.example.player.main', type: 'interactive', launchType: 'singleton' }
        ]
      })
    }
    expect(sandbox.calls()).toContain(`${SHELL} vpm info com.example.player.main`)
  })

  test('an app that isn’t installed exits 1', async () => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['apps', 'info', 'com.example.player', ...VVD, '--json'])

    expect(run.exitCode).toBe(1)
    expect(run.json<{ ok: false; error: { code: string; message: string } }>().error).toMatchObject(
      {
        code: 'APP_NOT_INSTALLED',
        message: 'com.example.player isn’t installed on Vega Virtual Device'
      }
    )
  })

  test('nothing given and nothing open exits 2', async () => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['apps', 'info', ...VVD, '--json'])

    expect(run.exitCode).toBe(2)
    expect(run.json<{ ok: false; error: { code: string } }>().error.code).toBe('NO_APP')
  })
})

const PLAYER = 'com.example.player'
const PKG_INFO = `${SHELL} vpm info ${PLAYER} --package`
const LAUNCH = `vega device launch-app -a ${PLAYER}.main --device VirtualDevice`
const TERMINATE = `${SHELL} vlcm terminate-app --pkg-id ${PLAYER}`
const FORCE = `${SHELL} vlcm terminate-app --force --pkg-id ${PLAYER}`
const UNINSTALL = `vega device uninstall-app -a ${PLAYER} --device VirtualDevice`

type Ok<T> = { ok: true } & T

describe('ovd apps actions', () => {
  test('install, launch, stop, restart and uninstall, each logged', async () => {
    const sandbox = await withPlayerProject()
    expect(
      (await ovd(sandbox, ['apps', 'install', `~/${AARCH64}`, ...VVD, '--json'])).exitCode
    ).toBe(0)

    const launch = await ovd(sandbox, ['apps', 'launch', PLAYER, ...VVD, '--json'])
    expect(launch.exitCode, launch.stdout).toBe(0)
    expect(launch.json<Ok<{ launch: LaunchResult }>>().launch.app.componentId).toBe(
      `${PLAYER}.main`
    )
    expect(sandbox.calls()).toEqual(expect.arrayContaining([PKG_INFO, LAUNCH]))
    expect(sandbox.world().running).toEqual([{ device: 'VirtualDevice', app: PLAYER }])
    const running = await ovd(sandbox, ['apps', '--running', ...VVD, '--json'])
    expect(running.json<Ok<AppList>>().apps.map((a) => a.packageId)).toEqual([PLAYER])

    const stop = await ovd(sandbox, ['apps', 'terminate', PLAYER, ...VVD, '--json'])
    expect(stop.json<Ok<{ terminate: TerminateResult }>>().terminate.wasRunning).toBe(true)
    expect(sandbox.world().running).toEqual([])

    // Nothing runs now: the tool exits 255, which is no error for OVD.
    const again = await ovd(sandbox, ['apps', 'terminate', PLAYER, ...VVD, '--json'])
    expect(again.exitCode).toBe(0)
    expect(again.json<Ok<{ terminate: TerminateResult }>>().terminate.wasRunning).toBe(false)

    sandbox.clearCalls()
    const started = await ovd(sandbox, ['apps', 'restart', PLAYER, ...VVD, '--json'])
    expect(started.json<Ok<{ restart: RestartResult }>>().restart.wasRunning).toBe(false)
    expect(sandbox.calls()).not.toContain(TERMINATE)
    expect(sandbox.calls()).toContain(LAUNCH)

    sandbox.clearCalls()
    const restarted = await ovd(sandbox, ['apps', 'restart', PLAYER, ...VVD, '--json'])
    expect(restarted.json<Ok<{ restart: RestartResult }>>().restart.wasRunning).toBe(true)
    const calls = sandbox.calls()
    expect(calls.indexOf(TERMINATE)).toBeGreaterThan(-1)
    expect(calls.indexOf(TERMINATE)).toBeLessThan(calls.indexOf(LAUNCH))

    const removed = await ovd(sandbox, ['apps', 'uninstall', PLAYER, ...VVD, '--json'])
    expect(removed.json<Ok<{ uninstall: UninstallResult }>>().uninstall.uninstalled).toBe(true)
    expect(sandbox.calls()).toContain(UNINSTALL)
    expect(sandbox.world().installed).toEqual([])
    expect((await ovd(sandbox, ['apps', ...VVD, '--json'])).json<Ok<AppList>>().apps).toEqual([])

    expect(sandbox.activity().map((a) => [a.action, a.result])).toEqual([
      ['app.install', 'ok'],
      ['app.launch', 'ok'],
      ['app.terminate', 'ok'],
      ['app.terminate', 'ok'],
      ['app.restart', 'ok'],
      ['app.restart', 'ok'],
      ['app.uninstall', 'ok']
    ])
  })

  test('terminate --force force stops, and the entry says so', async () => {
    const sandbox = await withPlayerProject()
    await ovd(sandbox, ['apps', 'install', `~/${AARCH64}`, ...VVD])
    await ovd(sandbox, ['apps', 'launch', PLAYER, ...VVD])

    const run = await ovd(sandbox, ['apps', 'terminate', PLAYER, '--force', ...VVD, '--json'])

    expect(run.exitCode).toBe(0)
    expect(run.json<Ok<{ terminate: TerminateResult }>>().terminate).toMatchObject({
      forced: true,
      wasRunning: null
    })
    expect(sandbox.calls()).toContain(FORCE)
    expect(sandbox.world().running).toEqual([])
    expect(sandbox.activity().at(-1)).toMatchObject({
      action: 'app.terminate',
      args: { app: PLAYER, force: 'true' },
      result: 'ok'
    })
  })

  test('reinstall a project folder: uninstall, then install its build for the target', async () => {
    const sandbox = await withPlayerProject()
    await ovd(sandbox, ['apps', 'install', `~/${AARCH64}`, ...VVD])
    sandbox.clearCalls()

    const run = await ovd(sandbox, ['apps', 'reinstall', '~/dev/player', ...VVD, '--json'])

    expect(run.exitCode, run.stdout).toBe(0)
    expect(run.json<Ok<{ reinstall: ReinstallResult }>>().reinstall).toMatchObject({
      uninstalled: true,
      package: { id: PLAYER, file: 'player_aarch64.vpkg' },
      forced: false
    })
    const calls = sandbox.calls()
    const install = `vega device install-app -p ${sandbox.home}/${AARCH64} --device VirtualDevice`
    expect(calls.indexOf(UNINSTALL)).toBeGreaterThan(-1)
    expect(calls.indexOf(UNINSTALL)).toBeLessThan(calls.indexOf(install))
    expect(sandbox.world().installed).toEqual([
      { device: 'VirtualDevice', package: 'player-aarch64-debug' }
    ])
    expect(sandbox.activity().filter((a) => a.action === 'app.reinstall')).toMatchObject([
      { result: 'ok' }
    ])
  })

  test('launching an app that isn’t installed exits 1 and launches nothing', async () => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['apps', 'launch', PLAYER, ...VVD, '--json'])

    expect(run.exitCode).toBe(1)
    expect(run.json<{ ok: false; error: { code: string } }>().error.code).toBe('APP_NOT_INSTALLED')
    expect(sandbox.calls()).not.toContain(LAUNCH)
    expect(sandbox.activity()).toMatchObject([
      { action: 'app.launch', result: 'error', errorCode: 'APP_NOT_INSTALLED' }
    ])
  })

  test('a stopped Virtual Device exits 4, asks it nothing and logs nothing', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()

    const run = await ovd(sandbox, ['apps', 'launch', PLAYER, ...VVD, '--json'])

    expect(run.exitCode).toBe(4)
    expect(run.json<{ ok: false; error: { code: string } }>().error.code).toBe('TARGET_OFFLINE')
    expect(appCalls(sandbox)).toEqual([])
    expect(sandbox.activity()).toEqual([])
  })
})
