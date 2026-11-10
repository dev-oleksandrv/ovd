import type { RunOutcome } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import { VVD_VDA_SERIAL } from '../fake-sdk/world.ts'
import { ovd, startOvd } from '../harness/cli.ts'
import { MANIFEST, makeProject, makeRecordedVpkg } from '../harness/project.ts'
import { createSandbox, type Sandbox } from '../harness/vitest.ts'

const LOG = `vega exec vda -s ${VVD_VDA_SERIAL} shell loggingctl log -f -o short_concise`
const AARCH64 = 'dev/player/build/aarch64-debug/player_aarch64.vpkg'
const ARMV7 = 'dev/player/build/armv7-release/player_armv7.vpkg'
const LAUNCH = 'vega device launch-app -a com.example.player.main --device VirtualDevice'
// The player's own manifest: the project the recorded player packages were built from.
const PLAYER_MANIFEST = MANIFEST.replaceAll('hellovega', 'player')

interface Line {
  ok?: boolean
  run?: RunOutcome
  error?: { code: string }
  ovd?: { kind: string }
  level?: string
  message?: string
}

// The Virtual Device running; a player project with a Debug build for it and a newer Release
// build for sticks (what `react-native build-vega` writes, ARCHITECTURE §8), opened.
async function withPlayerProject(world: Parameters<typeof createSandbox>[0] = {}) {
  const sandbox = createSandbox({ vvd: { running: true, developerMode: true }, ...world })
  sandbox.installSdk()
  makeProject(sandbox.home, 'player', { manifest: PLAYER_MANIFEST })
  makeRecordedVpkg(sandbox.home, AARCH64, 'player-aarch64-debug', new Date('2026-10-13T09:00:00Z'))
  makeRecordedVpkg(sandbox.home, ARMV7, 'player-armv7-release', new Date('2026-10-13T10:00:00Z'))
  expect((await ovd(sandbox, ['open', `${sandbox.home}/dev/player`])).exitCode).toBe(0)
  sandbox.clearCalls()
  return sandbox
}

const linesOf = (stdout: string): Line[] =>
  stdout
    .split('\n')
    .slice(0, -1)
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as Line)

// Every log stream the fake SDK started has exited.
function noStreamLeft(sandbox: Sandbox): void {
  const pids = sandbox.logStreamPids()
  expect(pids.length).toBeGreaterThan(0)
  for (const pid of pids) {
    expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
  }
}

describe('ovd run', () => {
  test('the Virtual Device: installs the aarch64 debug build, follows the log, launches it verified', async () => {
    const sandbox = await withPlayerProject()

    const running = startOvd(sandbox, ['run', '--json'])
    // The run first, then the stream's lines, the launch's OVD line among them.
    const out = await running.waitForStdout((s) => {
      const lines = linesOf(s)
      return lines.length > 10 && lines.some((l) => l.ovd?.kind === 'launch')
    })
    running.signal('SIGINT')
    const done = await running.done

    expect(done.exitCode).toBe(0)
    const [first, ...rest] = linesOf(out)
    expect(first).toMatchObject({
      ok: true,
      run: {
        target: { id: 'VirtualDevice', architecture: 'aarch64' },
        package: {
          path: `${sandbox.home}/${AARCH64}`,
          architecture: 'aarch64',
          buildType: 'debug',
          folder: 'build/aarch64-debug/'
        },
        forced: false,
        launch: { verified: true, launched: true, app: { packageId: 'com.example.player' } }
      }
    })
    expect(rest.filter((l) => l.level !== undefined && l.ovd === undefined).length).toBeGreaterThan(
      5
    )
    expect(done.stderr).toContain('Found build build/aarch64-debug/player_aarch64.vpkg (debug)')

    // Installed the Debug build, started the stream after the install and before the launch.
    const calls = sandbox.calls()
    const install = calls.indexOf(
      `vega device install-app -p ${sandbox.home}/${AARCH64} --device VirtualDevice`
    )
    expect(install).toBeGreaterThanOrEqual(0)
    expect(calls.some((c) => c.includes(`install-app -p ${sandbox.home}/${ARMV7}`))).toBe(false)
    expect(calls.indexOf(LOG)).toBeGreaterThan(install)
    expect(calls.indexOf(LAUNCH)).toBeGreaterThan(calls.indexOf(LOG))
    expect(sandbox.activity().map((a) => [a.action, a.result])).toEqual([
      ['app.install', 'ok'],
      ['logs', 'ok'],
      ['app.restart', 'ok']
    ])
    expect(sandbox.world().running).toEqual([
      { device: 'VirtualDevice', app: 'com.example.player' }
    ])
    noStreamLeft(sandbox)
  })

  test('a crash on launch exits 7 with the run and its cause, and leaves no stream running', async () => {
    const sandbox = await withPlayerProject({ playerCrashesOnLaunch: true })

    const run = await ovd(sandbox, ['run', '--json'])

    expect(run.exitCode).toBe(7)
    const doc = run.json<Line>()
    expect(doc).toMatchObject({
      ok: false,
      error: { code: 'LAUNCH_NOT_VERIFIED' },
      run: { launch: { verified: false, reason: 'crashed' } }
    })
    expect(sandbox.activity().map((a) => [a.action, a.result])).toEqual([
      ['app.install', 'ok'],
      ['logs', 'ok'],
      ['app.restart', 'error']
    ])
    noStreamLeft(sandbox)
  })

  test('a stopped Virtual Device exits 4 and installs nothing', async () => {
    const sandbox = await withPlayerProject({ vvd: { running: false, developerMode: true } })

    const run = await ovd(sandbox, ['run', '--device', 'VirtualDevice', '--json'])

    expect(run.exitCode).toBe(4)
    expect(run.json<Line>().error?.code).toBe('TARGET_OFFLINE')
    const calls = sandbox.calls()
    expect(calls.some((c) => c.includes('install-app') || c.includes('loggingctl'))).toBe(false)
    expect(sandbox.activity()).toEqual([
      expect.objectContaining({
        action: 'app.install',
        target: null,
        result: 'error',
        errorCode: 'TARGET_OFFLINE'
      })
    ])
  })
})
