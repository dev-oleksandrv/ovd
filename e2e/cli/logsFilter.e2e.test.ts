import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { BURST_LINES, bootIdAfter, usbStick, type World } from '../fake-sdk/world.ts'
import { ovd } from '../harness/cli.ts'
import { createSandbox, type Sandbox } from '../harness/vitest.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const PLAYER = 'com.example.player'

interface Line {
  time: string
  level?: string
  process?: string | null
  pid?: number | null
  tag?: string
  message: string
  boot?: string
  ovd?: { kind: string; process?: string; hidden?: number; second?: string }
}

// The presets recording (fixtures/0.24/loggingctl-log/virtual-device-presets.txt) followed by the
// burst: BURST_LINES lines of `com.example.player[31000]` in the device second 09:43:19, then
// one line of another process at 09:43:20. The fake stream never ends by itself, so each run
// ends with `--until`: the closer line is the first entry past it.
function withPresets(world: Partial<World> = {}): Sandbox {
  const sandbox = createSandbox({
    stick: usbStick(),
    logStream: { ends: false, holdAfterLine: null, recording: 'presets', burst: true },
    ...world
  })
  sandbox.installSdk()
  return sandbox
}

// The Virtual Device with the player side-loaded (its recorded package), so the player's lines
// are an app's. The stick is recorded with no side-loaded app (fixtures/0.24/vpm-info-package-all).
function withPlayer(): Sandbox {
  return withPresets({
    stick: null,
    vvd: { running: true, developerMode: true },
    installed: [{ device: 'VirtualDevice', package: 'player-aarch64-debug' }]
  })
}

// A device time (UTC, no year) as core reads it: the current UTC year, the next, or the one
// before, whichever puts it no more than a day ahead of now (packages/core/src/logs/logTime.ts).
function instant(month: number, day: number, time: string): string {
  const [hh = 0, mm = 0, ss = 0, ms = 0] = time.split(/[:.]/).map(Number)
  const now = Date.now()
  const year = new Date(now).getUTCFullYear()
  const at = (y: number) => Date.UTC(y, month, day, hh, mm, ss, ms)
  return new Date(
    [year + 1, year].map(at).find((t) => t - now <= DAY_MS) ?? at(year - 1)
  ).toISOString()
}
// After the burst (09:43:19.0xx) and before the closer line (09:43:20.000).
const UNTIL_BURST = instant(10, 14, '09:43:19.900')
// After the recording (last line 09:43:18.546) and before the burst.
const UNTIL_RECORDING = instant(10, 14, '09:43:18.900')

async function logLines(sandbox: Sandbox, args: string[], until = UNTIL_BURST) {
  const run = await ovd(sandbox, ['logs', ...args, '--json', '--until', until])
  expect(run.exitCode).toBe(0)
  const lines = run.jsonLines<Line>()
  return {
    events: lines.filter((l) => l.ovd !== undefined),
    device: lines.filter((l) => l.ovd === undefined)
  }
}

describe('ovd logs presets', () => {
  test('all shows everything: the recording and the burst', async () => {
    const { device } = await logLines(withPresets(), ['--preset', 'all'])
    expect(device.filter((l) => l.pid === 31000)).toHaveLength(BURST_LINES)
    expect(device.length).toBeGreaterThan(BURST_LINES + 100)
  }, 60_000)

  test('network keeps only the lines that name a network word', async () => {
    const { device } = await logLines(withPresets(), ['--preset', 'network'], UNTIL_RECORDING)
    expect(device.length).toBeGreaterThan(0)
    for (const line of device) {
      expect(`${line.tag} ${line.message}`).toMatch(
        /\b(?:http|https|fetch|xhr|XMLHttpRequest|websocket|socket|dns|network|connectivity|wifi|ethernet|tls|ssl|timeout(?!=))\b/i
      )
    }
  }, 60_000)

  test('lifecycle keeps the lifecycle service and its words, and drops the rest', async () => {
    const sandbox = withPresets()
    const all = await logLines(sandbox, ['--preset', 'all'], UNTIL_RECORDING)
    const { device } = await logLines(sandbox, ['--preset', 'lifecycle'], UNTIL_RECORDING)
    expect(device.length).toBeGreaterThan(0)
    expect(device.length).toBeLessThan(all.device.length)
    expect(device.some((l) => l.process === 'lcm_service')).toBe(true)
  }, 90_000)

  test('app-errors shows the side-loaded app’s error lines and no system line', async () => {
    const sandbox = withPlayer()
    const errors = await logLines(sandbox, ['--preset', 'app-errors'])
    expect(errors.device.length).toBeGreaterThan(0)
    for (const line of errors.device) {
      expect(line.process).toBe(PLAYER)
      expect(line.level).toBe('E')
    }
    // `--level info` replaces the preset's level; the apps-only part stays.
    const info = await logLines(sandbox, ['--preset', 'app-errors', '--level', 'info'])
    expect(info.device.length).toBeGreaterThanOrEqual(errors.device.length)
    for (const line of info.device) expect(line.process).toBe(PLAYER)
    expect(info.events.map((e) => e.ovd?.kind)).not.toContain('app-list-unavailable')
    // Without the app on the device there is nothing of an app's to show.
    expect((await logLines(withPresets(), ['--preset', 'app-errors'])).device).toEqual([])
  }, 90_000)

  test('an unknown preset is exit 2 and starts no stream', async () => {
    const sandbox = withPresets()
    const run = await ovd(sandbox, ['logs', '--preset', 'nope', '--json'])
    expect(run.exitCode).toBe(2)
    expect(run.json()).toMatchObject({ ok: false, error: { code: 'UNKNOWN_LOG_PRESET' } })
    expect(sandbox.calls().filter((c) => c.includes('loggingctl'))).toEqual([])
  })
})

describe('ovd logs advanced filters', () => {
  test('--pid keeps one process; --boot current keeps the lines of this boot', async () => {
    const sandbox = withPresets()
    const pid = await logLines(sandbox, ['--pid', '31000'])
    expect(pid.device).toHaveLength(BURST_LINES)
    expect(pid.events).toEqual([])

    const boot = await logLines(sandbox, ['--boot', 'current', '--pid', '31000'])
    expect(boot.device).toHaveLength(BURST_LINES)
    // Another boot's lines are not this boot's.
    const other = await logLines(sandbox, ['--boot', bootIdAfter(1), '--pid', '31000'])
    expect(other.device).toEqual([])
  }, 90_000)

  test('--boot current with an unreadable boot ID shows no line and says why', async () => {
    const sandbox = withPresets({ boot: { reboots: 0, readFails: true } })
    const { device, events } = await logLines(sandbox, ['--boot', 'current'])
    expect(device).toEqual([])
    expect(events.map((e) => e.ovd?.kind)).toContain('boot-unknown')
    expect(events.find((e) => e.ovd?.kind === 'boot-unknown')?.message).toMatch(/Boot ID unknown/)
  }, 60_000)

  test('--mute hides a process; no rate event comes with it', async () => {
    const { device, events } = await logLines(withPresets(), ['--mute', PLAYER])
    expect(device.some((l) => l.process === PLAYER)).toBe(false)
    expect(device.length).toBeGreaterThan(0)
    expect(events).toEqual([])
  }, 60_000)

  test('--process-rate shows n lines a second and reports the hidden ones', async () => {
    const { device, events } = await logLines(withPresets(), ['--process-rate', `${PLAYER}=5`])
    expect(device.filter((l) => l.pid === 31000)).toHaveLength(5)
    const burst = events.at(-1)
    expect(burst).toMatchObject({
      ovd: { kind: 'rate-limited', process: PLAYER, hidden: BURST_LINES - 5 },
      message: `${PLAYER}: ${BURST_LINES - 5} lines hidden by rate limit`
    })
    expect(burst?.ovd?.second).toMatch(/^\d{4}-11-14T09:43:19Z$/)
  }, 60_000)

  test('the rate event is an OVD line in human output', async () => {
    const run = await ovd(withPresets(), [
      'logs',
      '--process-rate',
      `${PLAYER}=5`,
      '--until',
      UNTIL_BURST
    ])
    expect(run.exitCode).toBe(0)
    expect(run.stdout).toMatch(
      new RegExp(
        `^\\d\\d:\\d\\d:\\d\\d\\.\\d{3} OVD ${PLAYER}: ${BURST_LINES - 5} lines hidden by rate limit$`,
        'm'
      )
    )
  }, 60_000)

  test('--process-level raises one process above the global level', async () => {
    const { device } = await logLines(withPresets(), ['--process-level', `${PLAYER}=error`])
    const player = device.filter((l) => l.process === PLAYER)
    expect(player.length).toBeGreaterThan(0)
    for (const line of player) expect(line.level).toBe('E')
    // The other processes keep the global level: their info lines are still there.
    expect(device.some((l) => l.process !== PLAYER && l.level === 'I')).toBe(true)
  }, 60_000)

  test('the flags apply to --export', async () => {
    const sandbox = withPresets()
    const file = join(sandbox.home, 'burst.jsonl')
    const run = await ovd(sandbox, [
      'logs',
      '--pid',
      '31000',
      '--export',
      file,
      '--format',
      'jsonl',
      '--until',
      UNTIL_BURST,
      '--json'
    ])
    expect(run.exitCode).toBe(0)
    expect(run.json()).toMatchObject({ ok: true, path: file, format: 'jsonl', lines: BURST_LINES })
    expect(readFileSync(file, 'utf8').split('\n').filter(Boolean)).toHaveLength(BURST_LINES)
  }, 60_000)

  test('a bad process rule or an invalid value is exit 2', async () => {
    const sandbox = withPresets()
    for (const args of [
      ['--process-rate', 'nope'],
      ['--process-rate', `${PLAYER}=0`],
      ['--pid', 'x']
    ]) {
      const run = await ovd(sandbox, ['logs', ...args, '--json'])
      expect(run.exitCode, args.join(' ')).toBe(2)
      expect(run.json()).toMatchObject({ ok: false, error: { code: 'INVALID_LOG_FILTER' } })
    }
    expect(sandbox.calls().filter((c) => c.includes('loggingctl'))).toEqual([])
  })
})

describe('ovd logs filter', () => {
  test('save, list, use by --preset, override, remove', async () => {
    const sandbox = withPresets()
    const saved = await ovd(sandbox, [
      'logs',
      'filter',
      'save',
      'player-only',
      '--pid',
      '31000',
      '--level',
      'info',
      '--json'
    ])
    expect(saved.exitCode).toBe(0)
    expect(saved.json()).toEqual({
      ok: true,
      filter: { name: 'player-only', filter: { pid: ['31000'], level: 'info' } }
    })

    const listed = await ovd(sandbox, ['logs', 'filter', 'list', '--json'])
    expect(listed.exitCode).toBe(0)
    const doc = listed.json<{
      presets: { name: string; label: string; builtin: boolean }[]
      filters: { name: string; valid: boolean }[]
    }>()
    expect(doc.presets.map((p) => p.name)).toEqual(['all', 'app-errors', 'network', 'lifecycle'])
    expect(doc.presets[0]).toEqual({ name: 'all', label: 'All', builtin: true })
    expect(doc.filters).toEqual([
      { name: 'player-only', filter: { pid: ['31000'], level: 'info' }, valid: true }
    ])
    const human = await ovd(sandbox, ['logs', 'filter', 'list'])
    expect(human.stdout).toContain('player-only  --level info --pid 31000')

    const used = await logLines(sandbox, ['--preset', 'player-only'])
    expect(used.device).toHaveLength(BURST_LINES)
    // An explicit flag replaces the field of the saved filter.
    const overridden = await logLines(sandbox, ['--preset', 'player-only', '--pid', '896'])
    expect(overridden.device.length).toBeGreaterThan(0)
    for (const line of overridden.device) expect(line.pid).toBe(896)

    const removed = await ovd(sandbox, ['logs', 'filter', 'rm', 'player-only', '--json'])
    expect(removed.json()).toEqual({ ok: true, name: 'player-only' })
    const gone = await ovd(sandbox, ['logs', '--preset', 'player-only', '--json'])
    expect(gone.exitCode).toBe(2)
    expect(gone.json()).toMatchObject({ ok: false, error: { code: 'UNKNOWN_LOG_PRESET' } })
    expect(
      (await ovd(sandbox, ['logs', 'filter', 'list', '--json'])).json<{ filters: unknown[] }>()
        .filters
    ).toEqual([])
  }, 120_000)

  test('save refuses an existing name without --force, and bad or reserved names', async () => {
    const sandbox = withPresets()
    const save = (name: string, ...rest: string[]) =>
      ovd(sandbox, ['logs', 'filter', 'save', name, '--level', 'warn', ...rest, '--json'])
    expect((await save('mine')).exitCode).toBe(0)

    const again = await save('mine')
    expect(again.exitCode).toBe(2)
    expect(again.json()).toMatchObject({ ok: false, error: { code: 'LOG_FILTER_EXISTS' } })

    const forced = await ovd(sandbox, [
      'logs',
      'filter',
      'save',
      'mine',
      '--level',
      'error',
      '--force',
      '--json'
    ])
    expect(forced.json()).toMatchObject({ filter: { filter: { level: 'error' } } })

    for (const name of ['Bad Name', 'network']) {
      const bad = await save(name)
      expect(bad.exitCode, name).toBe(2)
      expect(bad.json()).toMatchObject({ ok: false, error: { code: 'INVALID_LOG_FILTER_NAME' } })
    }
    const invalid = await ovd(sandbox, [
      'logs',
      'filter',
      'save',
      'other',
      '--process-rate',
      'x',
      '--json'
    ])
    expect(invalid.exitCode).toBe(2)
    expect(invalid.json()).toMatchObject({ ok: false, error: { code: 'INVALID_LOG_FILTER' } })
  })

  test('rm of an unknown name fails; list is empty to begin with', async () => {
    const sandbox = withPresets()
    const empty = await ovd(sandbox, ['logs', 'filter', 'list'])
    expect(empty.stdout).toContain('Presets:')
    expect(empty.stdout).toContain('none (save one with: ovd logs filter save <name>)')
    const rm = await ovd(sandbox, ['logs', 'filter', 'rm', 'ghost', '--json'])
    expect(rm.exitCode).not.toBe(0)
    expect(rm.json()).toMatchObject({ ok: false })
  })
})
