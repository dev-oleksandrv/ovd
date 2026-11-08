import { describe, expect, test } from 'vitest'
import { STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'
import { ovd, startOvd } from '../harness/cli.ts'
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

// Every log stream the fake SDK started has exited (no orphaned `vega` left behind).
function noStreamLeft(sandbox: Sandbox): void {
  const pids = sandbox.logStreamPids()
  expect(pids.length).toBeGreaterThan(0)
  for (const pid of pids) {
    expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
  }
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

  test('an offline target exits 4 without starting the stream', async () => {
    const sandbox = withStick()
    const run = await ovd(sandbox, ['logs', '--device', 'VirtualDevice', '--json'])
    expect(run.exitCode).toBe(4)
    expect(run.json()).toMatchObject({ ok: false, error: { code: 'TARGET_OFFLINE' } })
    expect(sandbox.calls().filter((c) => c.includes('loggingctl'))).toEqual([])
  })

  test('a stream that ends by itself prints its lines, then the error, and exits 1', async () => {
    const sandbox = withStick({ logStream: { ends: true, holdAfterLine: null } })
    const run = await ovd(sandbox, ['logs', '--json'])
    expect(run.exitCode).toBe(1)
    const lines = run.jsonLines<Record<string, unknown>>()
    expect(lines).toHaveLength(21)
    expect(lines.slice(0, 20).every((l) => typeof l.message === 'string')).toBe(true)
    expect(lines.at(-1)).toMatchObject({ ok: false, error: { code: 'LOG_STREAM_ENDED' } })
    expect(sandbox.activity().filter((a) => a.action === 'logs')).toEqual([
      expect.objectContaining({ result: 'ok' })
    ])
  })
})
