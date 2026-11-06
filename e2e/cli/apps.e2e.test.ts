import type { AppDetails, AppList } from '@ovd/core'
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

    // Started outside OVD: launches come in 2.4b.
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
