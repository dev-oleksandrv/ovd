import { describe, expect, test } from 'vitest'
import { STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'
import { ovd, startOvd } from '../harness/cli.ts'
import { makeRecordedVpkg } from '../harness/project.ts'
import { stillRunning } from '../harness/sandbox.ts'
import { createSandbox, type Sandbox } from '../harness/vitest.ts'

const LOG = `vega exec vda -s ${STICK_SERIAL} shell loggingctl log -f -o short_concise`
const DAY_MS = 24 * 60 * 60 * 1000

interface JsonEntry {
  time: string
  level: string
  process: string | null
  pid: number | null
  message: string
}

function withStick(world: Parameters<typeof createSandbox>[0] = {}): Sandbox {
  const sandbox = createSandbox({ stick: usbStick(), ...world })
  sandbox.installSdk()
  return sandbox
}

// A fixture time (UTC, no year) as core reads it: the device prints no year, so core takes the
// current UTC year, the next one, or the one before, whichever puts the entry no more than a
// day ahead of now (packages/core/src/logs/logTime.ts). Computing it the same way keeps the
// test independent of today's date.
function fixtureInstant(month: number, day: number, time: string): string {
  const [hh = 0, mm = 0, ss = 0, ms = 0] = time.split(/[:.]/).map(Number)
  const now = Date.now()
  const year = new Date(now).getUTCFullYear()
  const at = (y: number) => Date.UTC(y, month, day, hh, mm, ss, ms)
  const instant = [year + 1, year].map(at).find((t) => t - now <= DAY_MS) ?? at(year - 1)
  return new Date(instant).toISOString()
}

// An OVD line of `ovd logs --json`: the event and its text.
interface JsonOvd {
  time: string
  ovd: { kind: string }
  message: string
}
type JsonLine = Partial<JsonEntry> & Partial<JsonOvd>

const VPKG = 'Downloads/player_armv7.vpkg'
// The entry on line 100 of stick-follow.txt, the last one before `holdAfterLine: 100` (its
// message shows again at line 149, at another time).
const HELD_LAST = { time: '07:27:00.940', message: 'Security Context User::Pkg::bd0b43dc' }
const printedHeld = (out: string) =>
  linesOf(out).some(
    (l) => l.time?.includes(HELD_LAST.time) === true && l.message?.includes(HELD_LAST.message)
  )

// The complete JSON lines printed so far.
function linesOf(stdout: string): JsonLine[] {
  return stdout
    .split('\n')
    .slice(0, -1)
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as JsonLine)
}
const kindsOf = (lines: JsonLine[]) => lines.flatMap((l) => (l.ovd ? [l.ovd.kind] : []))
const deviceLines = (lines: JsonLine[]) => lines.filter((l) => l.ovd === undefined && l.level)
const count = (lines: JsonLine[], kind: string) => kindsOf(lines).filter((k) => k === kind).length
const logCalls = (sandbox: Sandbox) => sandbox.calls().filter((c) => c === LOG).length
const restarts = (sandbox: Sandbox) => sandbox.activity().filter((a) => a.action === 'logs.restart')

// Every log stream the fake SDK started has exited (no orphaned `vega` left behind).
function noStreamLeft(sandbox: Sandbox): void {
  const pids = sandbox.logStreamPids()
  expect(pids.length).toBeGreaterThan(0)
  for (const pid of pids) {
    expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
  }
}

// After a forced stop (exit 130 or 143) ovd doesn't wait for the group, so a stream may still
// be exiting, or waiting to be reaped, when ovd has exited: poll, with a bound.
async function noStreamLeftAfterExit(sandbox: Sandbox): Promise<void> {
  expect(sandbox.logStreamPids().length).toBeGreaterThan(0)
  await expect.poll(() => stillRunning(sandbox.logStreamPids()), { timeout: 5_000 }).toEqual([])
}

describe('ovd logs', () => {
  test('--app and --level keep the two player errors; --until ends it at a later entry', async () => {
    const sandbox = withStick()
    // Between "player flood 11" (stick-follow.txt:210) and "player flood 12" (:211), after
    // both error lines (:35, :185).
    const until = fixtureInstant(10, 8, '07:27:01.270')
    const run = await ovd(sandbox, [
      'logs',
      '--app',
      'com.example.player',
      '--level',
      'error',
      '--json',
      '--until',
      until
    ])
    expect(run.exitCode).toBe(0)
    const lines = run.jsonLines<JsonEntry>()
    expect(lines.map((l) => l.message)).toEqual([
      '[KeplerScript-JavaScript] player error tick 1',
      '[KeplerScript-JavaScript] player error tick 2'
    ])
    for (const line of lines) {
      expect(line).toMatchObject({ level: 'E', process: 'com.example.player', pid: 27178 })
    }
    expect(sandbox.calls().filter((c) => c.includes('loggingctl'))).toEqual([LOG])
    expect(sandbox.activity().filter((a) => a.action === 'logs')).toEqual([
      expect.objectContaining({
        surface: 'cli',
        target: STICK_SERIAL,
        result: 'ok',
        args: { app: 'com.example.player', level: 'error', until }
      })
    ])
    noStreamLeft(sandbox)
  })

  test('--until by the clock: no entry after it is printed', async () => {
    const sandbox = withStick()
    const until = new Date(Date.now() + 3_000).toISOString()
    const run = await ovd(sandbox, ['logs', '--json', '--until', until])
    expect(run.exitCode).toBe(0)
    for (const line of run.jsonLines<JsonEntry>()) {
      expect(Date.parse(line.time)).toBeLessThanOrEqual(Date.parse(until))
    }
    noStreamLeft(sandbox)
  })

  test('Ctrl+C stops the stream and its process group, and exits 0', async () => {
    const sandbox = withStick()
    const running = startOvd(sandbox, ['logs', '--json'])
    await running.waitForStdout((out) => out.includes('\n'))
    running.signal('SIGINT')
    const run = await running.done
    expect(run.exitCode).toBe(0)
    expect(run.jsonLines<JsonEntry>().length).toBeGreaterThan(0)
    noStreamLeft(sandbox)
  })

  // The stdout isn't parsed in the forced stops: a forced exit may cut its last line.
  test("SIGTERM stops the stream's process group and exits 143", async () => {
    const sandbox = withStick()
    const running = startOvd(sandbox, ['logs', '--json'])
    await running.waitForStdout((out) => out.includes('\n'))
    running.signal('SIGTERM')
    const run = await running.done
    expect(run.exitCode).toBe(143)
    await noStreamLeftAfterExit(sandbox)
  })

  test('a second Ctrl+C stops a stream that ignores the first SIGTERM, and exits 130', async () => {
    const sandbox = withStick({
      logStream: { ends: false, holdAfterLine: null, ignoreFirstSigterm: true }
    })
    const running = startOvd(sandbox, ['logs', '--json'])
    await running.waitForStdout((out) => out.includes('\n'))
    running.signal('SIGINT')
    // Two signals sent back to back can merge into one: wait until the first Ctrl+C's SIGTERM
    // reached the stream's group, within core's 2 s grace before SIGKILL.
    await expect.poll(() => sandbox.world().logStream.ignoreFirstSigterm).toBe(false)
    running.signal('SIGINT')
    const run = await running.done
    expect(run.exitCode).toBe(130)
    await noStreamLeftAfterExit(sandbox)
  })

  test('an offline target exits 4 without starting the stream', async () => {
    const sandbox = withStick()
    const run = await ovd(sandbox, ['logs', '--device', 'VirtualDevice', '--json'])
    expect(run.exitCode).toBe(4)
    expect(run.json()).toMatchObject({ ok: false, error: { code: 'TARGET_OFFLINE' } })
    expect(sandbox.calls().filter((c) => c.includes('loggingctl'))).toEqual([])
  })

  test('three installs from other processes restart the stream each time; lines arrive once', async () => {
    const sandbox = withStick({ logStream: { ends: false, holdAfterLine: 100 } })
    makeRecordedVpkg(sandbox.home, VPKG, 'player-armv7-release')
    const running = startOvd(sandbox, ['logs', '--json'], { timeoutMs: 55_000 })
    await running.waitForStdout(printedHeld)
    // Each install waits for its restart, so each gives exactly one (coalescing is unit-tested).
    for (let n = 1; n <= 3; n++) {
      const install = await ovd(sandbox, ['install', `~/${VPKG}`, '--json'])
      expect(install.exitCode).toBe(0)
      await running.waitForStdout((out) => count(linesOf(out), 'restarted') === n)
    }
    sandbox.update((w) => {
      w.logStream.holdAfterLine = null
    })
    await running.waitForStdout((out) =>
      linesOf(out).some((l) => l.message === '[KeplerScript-JavaScript] player flood 62')
    )
    const pids = sandbox.logStreamPids()
    expect(pids).toHaveLength(4)
    expect(stillRunning(pids)).toEqual([pids.at(-1)])
    running.signal('SIGINT')
    const run = await running.done
    expect(run.exitCode).toBe(0)
    const lines = linesOf(run.stdout)
    expect(kindsOf(lines)).toEqual([
      'install',
      'restarted',
      'install',
      'restarted',
      'install',
      'restarted'
    ])
    expect(lines.find((l) => l.ovd?.kind === 'install')?.message).toBe(
      'Installed player_armv7.vpkg from the CLI'
    )
    const device = deviceLines(lines)
    expect(device).toHaveLength(243)
    expect(new Set(device.map((l) => `${l.time} ${l.message}`)).size).toBe(243)
    expect(logCalls(sandbox)).toBe(4)
    expect(restarts(sandbox)).toEqual(
      Array.from({ length: 3 }, () =>
        expect.objectContaining({
          surface: 'cli',
          target: STICK_SERIAL,
          args: { reason: 'install' },
          result: 'ok'
        })
      )
    )
    noStreamLeft(sandbox)
  })

  test('--no-restart-after-install: one install line, one stream', async () => {
    const sandbox = withStick({ logStream: { ends: false, holdAfterLine: 100 } })
    makeRecordedVpkg(sandbox.home, VPKG, 'player-armv7-release')
    const running = startOvd(sandbox, ['logs', '--json', '--no-restart-after-install'])
    await running.waitForStdout(printedHeld)
    const [first = 0] = sandbox.logStreamPids()
    const install = await ovd(sandbox, ['install', `~/${VPKG}`, '--json'])
    expect(install.exitCode).toBe(0)
    await running.waitForStdout((out) => count(linesOf(out), 'install') === 1)
    expect(stillRunning([first])).toEqual([first])
    sandbox.update((w) => {
      w.logStream.holdAfterLine = null
    })
    await running.waitForStdout((out) =>
      linesOf(out).some((l) => l.message === '[KeplerScript-JavaScript] player flood 62')
    )
    running.signal('SIGINT')
    const run = await running.done
    expect(run.exitCode).toBe(0)
    expect(kindsOf(linesOf(run.stdout))).toEqual(['install'])
    expect(deviceLines(linesOf(run.stdout))).toHaveLength(243)
    expect(logCalls(sandbox)).toBe(1)
    expect(restarts(sandbox)).toEqual([])
    noStreamLeft(sandbox)
  })

  test('a reboot: disconnected, then reconnected, then lines', async () => {
    const sandbox = withStick({ logStream: { ends: false, holdAfterLine: null, reboot: true } })
    const running = startOvd(sandbox, ['logs', '--json'])
    await running.waitForStdout((out) =>
      linesOf(out).some((l) => l.message === '[KeplerScript-JavaScript] player flood 62')
    )
    running.signal('SIGINT')
    const run = await running.done
    expect(run.exitCode).toBe(0)
    const lines = linesOf(run.stdout)
    expect(kindsOf(lines)).toEqual(['disconnected', 'reconnected'])
    const reconnected = lines.findIndex((l) => l.ovd?.kind === 'reconnected')
    expect(lines.findIndex((l) => l.ovd?.kind === 'disconnected')).toBeLessThan(reconnected)
    expect(deviceLines(lines.slice(reconnected + 1))).toHaveLength(243)
    expect(lines.find((l) => l.ovd?.kind === 'disconnected')?.message).toBe(
      'Device dropped · reconnecting…'
    )
    expect(logCalls(sandbox)).toBe(2)
    expect(restarts(sandbox)).toEqual([
      expect.objectContaining({ args: { reason: 'reconnect' }, result: 'ok' })
    ])
    noStreamLeft(sandbox)
  })

  test('streams that end at once reconnect twice, then give up: the error last, exit 1', async () => {
    const sandbox = withStick({ logStream: { ends: true, holdAfterLine: null } })
    const run = await ovd(sandbox, ['logs', '--json'])
    expect(run.exitCode).toBe(1)
    const lines = run.jsonLines<Record<string, unknown>>()
    expect(lines.at(-1)).toMatchObject({ ok: false, error: { code: 'LOG_STREAM_ENDED' } })
    const printed = linesOf(run.stdout)
    expect(deviceLines(printed)).toHaveLength(20)
    expect(kindsOf(printed)).toEqual(['disconnected', 'reconnected', 'disconnected', 'reconnected'])
    expect(logCalls(sandbox)).toBe(3)
    expect(sandbox.activity().filter((a) => a.action === 'logs')).toEqual([
      expect.objectContaining({ result: 'ok' })
    ])
    expect(restarts(sandbox)).toEqual([
      expect.objectContaining({ args: { reason: 'reconnect' }, result: 'ok' }),
      expect.objectContaining({ args: { reason: 'reconnect' }, result: 'ok' }),
      expect.objectContaining({
        args: { reason: 'reconnect' },
        result: 'error',
        errorCode: 'LOG_STREAM_ENDED'
      })
    ])
    noStreamLeft(sandbox)
  })
})
