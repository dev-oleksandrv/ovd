import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Crash, CrashesList, CrashPullResult, LaunchResult } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import { decodeScript } from '../fake-sdk/scripts.ts'
import { STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'
import { ovd, startOvd } from '../harness/cli.ts'
import { injectPlayerCrash, markCrashUninstalled } from '../harness/crash.ts'
import { MANIFEST, makeProject, makeRecordedVpkg } from '../harness/project.ts'
import { createSandbox, type Sandbox } from '../harness/vitest.ts'

const AARCH64 = 'dev/player/build/aarch64-debug/player_aarch64.vpkg'
const VVD = ['--device', 'VirtualDevice']
const PLAYER = 'com.example.player'
const PLAYER_MANIFEST = MANIFEST.replaceAll('hellovega', 'player')
const SYNTHETIC = readFileSync(
  new URL('../../fixtures/0.24/vda-pull/synthetic-crash.acr', import.meta.url)
)
// The system package's reports in the recorded listing: core must never list or pull them.
const SYSTEM_INDEXES = [50, 55, 67]
const PULL_SCRIPT = /loggingctl vault --cat SYSTEM_TOMBSTONE (\d+) > "\$f"/
const REMOTE_PULL =
  /^vega exec vda -s emulator-5554 pull (\/tmp\/ovd-acr\.[A-Za-z0-9]{6}\/report\.acr) /
const RM_RF = /^vega exec vda -s emulator-5554 shell rm -rf (\/tmp\/ovd-acr\.[A-Za-z0-9]{6})$/

type Ok<T> = { ok: true } & T
interface Failed {
  ok: false
  error: { code: string; message: string; hint: string }
}

// The Virtual Device running with the player installed from its recorded package, so the player's
// crash reports are in scope. `crashes` is the folder the reports are saved in (OVD_CRASHES).
async function withPlayer(): Promise<{
  sandbox: Sandbox
  crashes: string
  env: Record<string, string>
}> {
  const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
  sandbox.installSdk()
  makeProject(sandbox.home, 'player', { manifest: PLAYER_MANIFEST })
  makeRecordedVpkg(sandbox.home, AARCH64, 'player-aarch64-debug', new Date('2026-10-13T09:00:00Z'))
  expect((await ovd(sandbox, ['open', `${sandbox.home}/dev/player`])).exitCode).toBe(0)
  expect((await ovd(sandbox, ['apps', 'install', `~/${AARCH64}`, ...VVD])).exitCode).toBe(0)
  const crashes = join(sandbox.home, 'crashes')
  sandbox.clearCalls()
  return { sandbox, crashes, env: { OVD_CRASHES: crashes } }
}

const files = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).sort() : [])
const mode = (path: string): number => statSync(path).mode & 0o777
const crashCalls = (sandbox: Sandbox): string[] =>
  sandbox
    .calls()
    .filter(
      (c) =>
        c.includes('vault') ||
        c.includes(' pull ') ||
        RM_RF.test(c) ||
        PULL_SCRIPT.test(decodeScript(c.replace(/^.* shell /, 'shell ')) ?? '')
    )
const pullScripts = (sandbox: Sandbox): string[] =>
  sandbox.calls().flatMap((c) => {
    const script = decodeScript(c.replace(/^.* shell /, 'shell '))
    return script !== null && PULL_SCRIPT.test(script) ? [PULL_SCRIPT.exec(script)?.[1] ?? ''] : []
  })
const crashActivity = (sandbox: Sandbox, action: string) =>
  sandbox.activity().filter((a) => a.action === action)

describe('ovd crashes', () => {
  test('lists the player’s reports only, newest first; no system package, none marked new', async () => {
    const { sandbox, env } = await withPlayer()
    injectPlayerCrash(sandbox)

    const run = await ovd(sandbox, ['crashes', ...VVD, '--json'], { env })

    expect(run.exitCode, run.stderr).toBe(0)
    const doc = run.json<Ok<CrashesList>>()
    expect(doc.device).toBe('VirtualDevice')
    // The 19 recorded reports of the player plus the injected one; the system package's three
    // are in the same listing.
    expect(doc.crashes).toHaveLength(20)
    expect(doc.crashes.every((c) => c.package === PLAYER)).toBe(true)
    for (const index of SYSTEM_INDEXES) expect(doc.crashes.map((c) => c.id)).not.toContain(index)
    expect(doc.crashes[0]).toMatchObject({ id: 105, kind: 'js', pid: 7746, signal: 6, new: false })
    const times = doc.crashes.map((c) => Date.parse(c.time))
    expect(times).toEqual([...times].sort((a, b) => b - a))
    // One listing; the only reads are the player's, and no system report was ever read.
    const reads = sandbox.calls().flatMap((c) => {
      const script = decodeScript(c.replace(/^.* shell /, 'shell ')) ?? ''
      return /vault --cat SYSTEM_TOMBSTONE (\d+)/.exec(script)?.[1] ?? []
    })
    expect(reads.length).toBeGreaterThan(0)
    for (const index of SYSTEM_INDEXES) expect(reads).not.toContain(String(index))
  })

  test('human output: one line per report, the app, kind and pid', async () => {
    const { sandbox, env } = await withPlayer()
    injectPlayerCrash(sandbox)

    const run = await ovd(sandbox, ['crashes', ...VVD], { env })

    expect(run.exitCode).toBe(0)
    const lines = run.stdout.trimEnd().split('\n')
    expect(lines).toHaveLength(20)
    expect(lines[0]).toMatch(/^105 +js +com\.example\.player +.*pid 7746/)
    expect(run.stdout).not.toContain('com_amazon_diode')
  })

  test('a stick with no side-loaded app lists nothing: the third-party lrk report never shows', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    sandbox.installSdk()
    injectPlayerCrash(sandbox, 'stick')

    const run = await ovd(sandbox, ['crashes', '--json'])

    expect(run.exitCode, run.stderr).toBe(0)
    expect(run.json<Ok<CrashesList>>().crashes).toEqual([])
    // Nothing of the lrk entry or the stick's player was read.
    expect(pullScripts(sandbox)).toEqual([])
    expect(
      sandbox
        .calls()
        .filter((c) => decodeScript(c.replace(/^.* shell /, 'shell '))?.includes('vault --cat'))
    ).toEqual([])
  })

  test('an offline target exits 4 TARGET_OFFLINE with no vault read', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    sandbox.installSdk()
    expect((await ovd(sandbox, ['target', 'set', STICK_SERIAL])).exitCode).toBe(0)
    sandbox.update((w) => {
      if (w.stick) w.stick.usbCable = false
    })
    sandbox.clearCalls()

    const run = await ovd(sandbox, ['crashes', '--json'])

    expect(run.exitCode).toBe(4)
    expect(run.json<Failed>().error.code).toBe('TARGET_OFFLINE')
    expect(sandbox.calls().filter((c) => c.includes('vault'))).toEqual([])
  })
})

describe('ovd crashes --watch', () => {
  test('prints the list, then a crash injected while it runs, and exits 0 on Ctrl+C', async () => {
    const { sandbox, env } = await withPlayer()
    const running = startOvd(sandbox, ['crashes', '--watch', ...VVD, '--json'], { env })
    const first = await running.waitForStdout((out) => out.includes('\n'))
    expect(JSON.parse(first.split('\n')[0] ?? '')).toMatchObject({
      ok: true,
      device: 'VirtualDevice'
    })
    expect(JSON.parse(first.split('\n')[0] ?? '').crashes).toHaveLength(19)

    injectPlayerCrash(sandbox)
    // The vault is polled every 5 s; the report is announced by the next poll.
    const out = await running.waitForStdout((o) => o.includes('"crash"'), 10_000)

    const lines = out
      .split('\n')
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l) as { ok: boolean; crash?: Crash })
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatchObject({
      ok: true,
      crash: { id: 105, package: PLAYER, kind: 'js', pid: 7746, signal: 6, new: true }
    })
    running.signal('SIGINT')
    const run = await running.done
    expect(run.exitCode).toBe(0)
    expect(run.jsonLines()).toHaveLength(2)
    expect(crashActivity(sandbox, 'crash.detected')).toEqual([
      expect.objectContaining({
        surface: 'cli',
        result: 'ok',
        args: expect.objectContaining({ package: PLAYER, index: 105, pid: 7746 })
      })
    ])
  }, 30_000)

  test('human output prints the new report as a line', async () => {
    const { sandbox, env } = await withPlayer()
    const running = startOvd(sandbox, ['crashes', '--watch', ...VVD], { env })
    await running.waitForStdout((out) => out.split('\n').length > 19)
    injectPlayerCrash(sandbox)

    const out = await running.waitForStdout((o) => /^105 .*NEW/m.test(o), 10_000)

    expect(out).toMatch(/^105 +js +com\.example\.player +NEW .*pid 7746/m)
    running.signal('SIGINT')
    expect((await running.done).exitCode).toBe(0)
  }, 30_000)
})

describe('ovd crash pull', () => {
  test('saves the whole report as a 0600 file with the name OVD builds, and cleans up the device', async () => {
    const { sandbox, crashes, env } = await withPlayer()
    injectPlayerCrash(sandbox)

    const run = await ovd(sandbox, ['crash', 'pull', '105', ...VVD, '--json'], { env })

    expect(run.exitCode, run.stderr).toBe(0)
    const doc = run.json<Ok<CrashPullResult>>()
    const epoch = Math.floor(Date.parse(doc.crash.time) / 1000)
    const name = `${PLAYER}-${epoch}-7746.acr`
    expect(doc.crash).toMatchObject({ id: 105, package: PLAYER, pid: 7746 })
    expect(doc.path.endsWith(`/crashes/${name}`)).toBe(true)
    expect(doc.bytes).toBe(SYNTHETIC.length)
    expect(files(crashes)).toEqual([name])
    expect(readFileSync(join(crashes, name)).equals(SYNTHETIC)).toBe(true)
    expect(mode(join(crashes, name))).toBe(0o600)
    expect(mode(crashes)).toBe(0o700)
    // The pull script for this index only, then `vda pull` of its file, then the folder removed.
    expect(pullScripts(sandbox)).toEqual(['105'])
    const calls = sandbox.calls()
    const pulled = calls.findIndex((c) => REMOTE_PULL.test(c))
    const folder = RM_RF.exec(calls.find((c) => RM_RF.test(c)) ?? '')?.[1]
    expect(pulled).toBeGreaterThan(-1)
    expect(REMOTE_PULL.exec(calls[pulled] ?? '')?.[1]?.startsWith(`${folder}/`)).toBe(true)
    expect(calls.findIndex((c) => RM_RF.test(c))).toBeGreaterThan(pulled)
    expect(sandbox.world().acrFiles).toEqual([])
    expect(crashActivity(sandbox, 'crash.pull')).toEqual([
      expect.objectContaining({
        surface: 'cli',
        result: 'ok',
        args: expect.objectContaining({ index: 105 })
      })
    ])
  })

  test('--out writes to the given file; an existing file without --force exits 2 and stays', async () => {
    const { sandbox, crashes, env } = await withPlayer()
    injectPlayerCrash(sandbox)
    const out = join(sandbox.home, 'mine.acr')
    writeFileSync(out, 'mine')

    const refused = await ovd(sandbox, ['crash', 'pull', '105', ...VVD, '--out', out, '--json'], {
      env
    })

    expect(refused.exitCode).toBe(2)
    expect(refused.json<Failed>().error.code).toBe('EXPORT_FILE_EXISTS')
    expect(readFileSync(out, 'utf8')).toBe('mine')
    expect(files(sandbox.home).filter((f) => f.includes('part') || f.startsWith('.ovd'))).toEqual(
      []
    )
    expect(files(crashes)).toEqual([])
    expect(crashActivity(sandbox, 'crash.pull').map((a) => [a.result, a.errorCode])).toEqual([
      ['error', 'EXPORT_FILE_EXISTS']
    ])

    const forced = await ovd(
      sandbox,
      ['crash', 'pull', '105', ...VVD, '--out', out, '--force', '--json'],
      { env }
    )

    expect(forced.exitCode, forced.stderr).toBe(0)
    expect(readFileSync(out).equals(SYNTHETIC)).toBe(true)
    expect(mode(out)).toBe(0o600)
    expect(files(crashes)).toEqual([])
  })

  test('a report of an app uninstalled since exits 1 CRASH_ACCESS_DENIED; nothing saved, the device cleaned', async () => {
    const { sandbox, crashes, env } = await withPlayer()
    injectPlayerCrash(sandbox)
    markCrashUninstalled(sandbox, 105)

    const run = await ovd(sandbox, ['crash', 'pull', '105', ...VVD, '--json'], { env })

    expect(run.exitCode).toBe(1)
    expect(run.json<Failed>().error).toMatchObject({
      code: 'CRASH_ACCESS_DENIED',
      hint: 'The app may have been uninstalled since it crashed'
    })
    expect(files(crashes)).toEqual([])
    expect(sandbox.calls().some((c) => RM_RF.test(c))).toBe(true)
    expect(sandbox.world().acrFiles).toEqual([])
    expect(crashActivity(sandbox, 'crash.pull').map((a) => [a.result, a.errorCode])).toEqual([
      ['error', 'CRASH_ACCESS_DENIED']
    ])
  })

  test('an id not in the list exits 1 CRASH_NOT_FOUND without reading the device', async () => {
    const { sandbox, crashes, env } = await withPlayer()

    const run = await ovd(sandbox, ['crash', 'pull', '9999', ...VVD, '--json'], { env })

    expect(run.exitCode).toBe(1)
    expect(run.json<Failed>().error.code).toBe('CRASH_NOT_FOUND')
    expect(pullScripts(sandbox)).toEqual([])
    expect(files(crashes)).toEqual([])
    expect(crashActivity(sandbox, 'crash.pull').map((a) => a.errorCode)).toEqual([
      'CRASH_NOT_FOUND'
    ])
  })

  test('a system package’s report is out of scope: CRASH_NOT_FOUND, never pulled', async () => {
    const { sandbox, crashes, env } = await withPlayer()

    const run = await ovd(sandbox, ['crash', 'pull', '50', ...VVD, '--json'], { env })

    expect(run.exitCode).toBe(1)
    expect(run.json<Failed>().error.code).toBe('CRASH_NOT_FOUND')
    expect(pullScripts(sandbox)).toEqual([])
    expect(files(crashes)).toEqual([])
  })

  test.each(['abc', '-1', '1.5', '', '105; reboot'])(
    'the id %j exits 2 INVALID_CRASH_ID with no SDK call',
    async (id) => {
      const { sandbox, crashes, env } = await withPlayer()

      const run = await ovd(sandbox, ['crash', 'pull', id, ...VVD, '--json'], { env })

      expect(run.exitCode).toBe(2)
      expect(run.json<Failed>().error.code).toBe('INVALID_CRASH_ID')
      expect(sandbox.calls()).toEqual([])
      expect(files(crashes)).toEqual([])
    }
  )

  test('an offline target exits 4 TARGET_OFFLINE with nothing run or written', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    sandbox.installSdk()
    expect((await ovd(sandbox, ['target', 'set', STICK_SERIAL])).exitCode).toBe(0)
    sandbox.update((w) => {
      if (w.stick) w.stick.usbCable = false
    })
    sandbox.clearCalls()
    const crashes = join(sandbox.home, 'crashes')

    const run = await ovd(sandbox, ['crash', 'pull', '105', '--json'], {
      env: { OVD_CRASHES: crashes }
    })

    expect(run.exitCode).toBe(4)
    expect(run.json<Failed>().error.code).toBe('TARGET_OFFLINE')
    expect(crashCalls(sandbox)).toEqual([])
    expect(existsSync(crashes)).toBe(false)
  })
})

describe('ovd apps launch --json with a crash', () => {
  test('the crash carries its vault index as crash.id, which crash pull takes', async () => {
    const { sandbox, crashes, env } = await withPlayer()
    sandbox.update((w) => {
      w.playerCrashesOnLaunch = true
    })

    const launch = await ovd(sandbox, ['apps', 'launch', PLAYER, ...VVD, '--json'], { env })

    expect(launch.exitCode, launch.stdout).toBe(7)
    const doc = launch.json<Failed & { launch: LaunchResult }>()
    expect(doc.launch).toMatchObject({
      verified: false,
      reason: 'crashed',
      crash: { id: 105, pid: 7746, signal: 'SIGABRT' }
    })

    // The launch already reported it: a listing doesn't mark it new, and the id pulls it.
    const pull = await ovd(sandbox, ['crash', 'pull', '105', ...VVD, '--json'], { env })
    expect(pull.exitCode, pull.stderr).toBe(0)
    expect(files(crashes)).toHaveLength(1)
  })
})
