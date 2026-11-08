import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createActivityLog,
  createDevices,
  createSdkLocator,
  createStateStore,
  OvdError,
  type ActivityEntry,
  type LogCounts,
  type LogEntry,
  type LogSession,
  type LogSessionEnd,
  type LogStartOptions
} from '../../src/index.js'
import { createLogs } from '../../src/logs/logSession.js'
import { FakeRunner, FakeStream } from '../support/fakeRunner.js'
import { fixture } from '../support/fixtures.js'

const STICK = 'G070000000000001'
const VDA = 'vega exec vda devices -l'
const STATUS = 'vega virtual-device status'
const STICK_INFO = `vega device info --device ${STICK}`
const LOG = `vega exec vda -s ${STICK} shell loggingctl log -f -o short_concise`
const PLAYER = 'com.example.player'
const NOW = new Date('2026-11-08T12:00:00Z')

const out = (path: string, exitCode = 0) => ({ stdout: fixture(`0.24/${path}`), exitCode })
const online = {
  [VDA]: out('vda-devices/stick-usb.txt'),
  [STATUS]: out('vega-virtual-device-status/stopped.json'),
  [STICK_INFO]: out('vega-device-info/stick-usb.json')
}
const FOLLOW = fixture('0.24/loggingctl-log/stick-follow.txt')
const REBOOT = fixture('0.24/loggingctl-log/stick-follow-reboot.txt')
const FLOOD_LINE = fixture('0.24/loggingctl-log/stick-follow-rate-limit.txt').split('\n')[0] ?? ''

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ovd-logs-'))
  // setImmediate stays real: the activity log writes files while the clock is fake.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: NOW })
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(home, { recursive: true, force: true })
})

// `logsDiscover` replaces the SDK only for the log session, so the target still resolves.
function setup(
  script: ConstructorParameters<typeof FakeRunner>[0],
  discover?: () => Promise<never>,
  logsDiscover?: () => Promise<never>
) {
  const runner = new FakeRunner(script)
  const sdk = createSdkLocator(
    discover ??
      (async () => ({
        vegaPath: '/sdk/vega',
        cli: 'manager' as const,
        sdkVersion: '0.24.12112',
        cliVersion: '1.4.5'
      }))
  )
  const ovdHome = join(home, '.config', 'ovd')
  const state = createStateStore(ovdHome)
  const activity = createActivityLog({ home: ovdHome, surface: 'cli' })
  const devices = createDevices({ runner, sdk, state, activity, env: {} })
  const logsSdk = logsDiscover ? createSdkLocator(logsDiscover) : sdk
  const logs = createLogs({ runner, sdk: logsSdk, devices, activity, now: () => new Date() })
  return { logs, runner }
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

const sdkMissing = async (): Promise<never> => {
  throw new OvdError('SDK_NOT_FOUND', 'No Vega SDK found', 'Install the Vega SDK')
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (condition()) return
    await settle()
  }
  throw new Error('waitFor: condition never held')
}

interface Started {
  session: LogSession
  stream: FakeStream
  runner: FakeRunner
  batches: { entries: LogEntry[]; counts: LogCounts; apps: string[] }[]
  delivered: () => LogEntry[]
  end: () => LogSessionEnd | undefined
}

// Starts a session on the stick and emits `first` to get it running.
async function startWith(
  opts: Omit<LogStartOptions, 'onEntries'> = {},
  first = `${FOLLOW.split('\n')[0] ?? ''}\n`
): Promise<Started> {
  const stream = new FakeStream()
  const { logs, runner } = setup({ ...online, [LOG]: stream })
  const batches: Started['batches'] = []
  const starting = logs.start({
    ...opts,
    onEntries: (entries, counts, apps) => batches.push({ entries, counts, apps })
  })
  await waitFor(() => stream.spec !== undefined)
  stream.emit(first)
  const session = await starting
  let ended: LogSessionEnd | undefined
  void session.done.then((end) => (ended = end))
  return {
    session,
    stream,
    runner,
    batches,
    delivered: () => batches.flatMap((b) => b.entries),
    end: () => ended
  }
}

// Splits text in three arbitrary places (mid-line on purpose).
const thirds = (text: string) => [text.slice(0, 1000), text.slice(1000, 17_777), text.slice(17_777)]

describe('logs.start', () => {
  test('runs loggingctl as a stream on the target and logs the start once', async () => {
    const { session, runner, stream } = await startWith({
      filter: { app: PLAYER, level: 'error' }
    })
    const call = runner.calls.find((c) => c.display === LOG)
    expect(call?.stream).toBeDefined()
    expect(call?.file).toBe('/sdk/vega')
    expect(call?.args).toEqual([
      'exec',
      'vda',
      '-s',
      STICK,
      'shell',
      'loggingctl',
      'log',
      '-f',
      '-o',
      'short_concise'
    ])
    expect(session).toMatchObject({
      target: { id: STICK, name: 'Fire TV stick' },
      command: LOG,
      startedAt: NOW.toISOString()
    })
    expect(await activity()).toEqual([
      {
        action: 'logs',
        target: STICK,
        args: { app: PLAYER, level: 'error' },
        result: 'ok'
      }
    ])
    await session.stop()
    expect(stream.stopped).toBe(true)
    expect(await activity()).toHaveLength(1)
  })

  test.each<[string, ConstructorParameters<typeof FakeRunner>[0], LogStartOptions, string]>([
    [
      'no target',
      {
        [VDA]: out('vda-devices/none.txt'),
        [STATUS]: out('vega-virtual-device-status/stopped.json')
      },
      {},
      'NO_TARGET'
    ],
    ['an offline target', online, { device: 'VirtualDevice' }, 'TARGET_OFFLINE'],
    ['an unknown device', online, { device: 'NOPE' }, 'DEVICE_NOT_FOUND']
  ])(
    'refuses %s without a loggingctl call or an activity entry',
    async (_n, script, opts, code) => {
      const { logs, runner } = setup({ ...script, [LOG]: new FakeStream() })
      await expect(logs.start(opts)).rejects.toMatchObject({ code })
      expect(runner.count(LOG)).toBe(0)
      expect(await activity()).toEqual([])
    }
  )

  test('refuses SDK_NOT_FOUND before the target without any call or activity entry', async () => {
    const { logs, runner } = setup(online, sdkMissing)
    await expect(logs.start()).rejects.toMatchObject({ code: 'SDK_NOT_FOUND' })
    expect(runner.calls).toEqual([])
    expect(await activity()).toEqual([])
  })

  test('logs one error entry when the SDK goes missing after the target is known', async () => {
    const { logs, runner } = setup({ ...online, [LOG]: new FakeStream() }, undefined, sdkMissing)
    await expect(logs.start({ filter: { level: 'error' } })).rejects.toMatchObject({
      code: 'SDK_NOT_FOUND'
    })
    expect(runner.count(LOG)).toBe(0)
    expect(await activity()).toEqual([
      {
        action: 'logs',
        target: STICK,
        args: { level: 'error' },
        result: 'error',
        errorCode: 'SDK_NOT_FOUND'
      }
    ])
  })

  test.each<[string, LogStartOptions['filter'], string]>([
    ['level', { level: 'loud' }, 'INVALID_LOG_FILTER'],
    ['regex', { search: '(', regex: true }, 'INVALID_LOG_FILTER'],
    ['app ID', { app: 'com.example;x' }, 'INVALID_APP_ID']
  ])('an invalid %s is refused before any SDK call', async (_n, filter, code) => {
    const { logs, runner } = setup(online)
    await expect(logs.start({ filter })).rejects.toMatchObject({ code })
    expect(runner.calls).toEqual([])
  })

  test('a stream that ends before any output fails the start with LOG_STREAM_ENDED', async () => {
    const stream = new FakeStream()
    const { logs } = setup({ ...online, [LOG]: stream })
    const starting = logs.start()
    await waitFor(() => stream.spec !== undefined)
    stream.end(0)
    await expect(starting).rejects.toMatchObject({ code: 'LOG_STREAM_ENDED' })
    expect(await activity()).toEqual([
      { action: 'logs', target: STICK, args: {}, result: 'error', errorCode: 'LOG_STREAM_ENDED' }
    ])
  })

  test('a quiet stream counts as started after 5 s', async () => {
    const stream = new FakeStream()
    const { logs } = setup({ ...online, [LOG]: stream })
    let started = false
    const starting = logs.start().then((s) => {
      started = true
      return s
    })
    await waitFor(() => stream.spec !== undefined)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(started).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const session = await starting
    expect(await activity()).toMatchObject([{ result: 'ok' }])
    await session.stop()
  })

  test('an abort during the start rejects with an AbortError and logs nothing', async () => {
    const stream = new FakeStream()
    const { logs } = setup({ ...online, [LOG]: stream })
    const controller = new AbortController()
    const starting = logs.start({ signal: controller.signal })
    await waitFor(() => stream.spec !== undefined)
    controller.abort()
    await expect(starting).rejects.toMatchObject({ name: 'AbortError' })
    expect(stream.stopped).toBe(true)
    expect(await activity()).toEqual([])
  })
})

describe('a running session', () => {
  test('the app and level filter deliver exactly the two error ticks', async () => {
    const s = await startWith({ filter: { app: PLAYER, level: 'error' } }, '')
    for (const chunk of thirds(FOLLOW)) s.stream.emit(chunk)
    await vi.advanceTimersByTimeAsync(250)
    expect(s.delivered().map((e) => e.message)).toEqual([
      '[KeplerScript-JavaScript] player error tick 1',
      '[KeplerScript-JavaScript] player error tick 2'
    ])
    expect(s.delivered().every((e) => e.level === 'E' && e.process === PLAYER)).toBe(true)
    expect(s.session.counts()).toMatchObject({ lines: 243, shown: 2 })
    await s.session.stop()
  })

  test('a batch where nothing matches still delivers fresh counts', async () => {
    const s = await startWith({ filter: { app: 'com.example.hellovega' } })
    const before = s.batches.length
    s.stream.emit(FOLLOW.split('\n').slice(1, 20).join('\n') + '\n')
    expect(s.batches.length).toBeGreaterThan(before)
    const last = s.batches.at(-1)
    expect(last?.entries).toEqual([])
    expect(last?.counts.lines).toBeGreaterThan(1)
    expect(last?.counts.shown).toBe(0)
    await s.session.stop()
  })

  test('a stream that ends by itself resolves done with LOG_STREAM_ENDED', async () => {
    const s = await startWith({}, REBOOT)
    s.stream.end(0)
    await waitFor(() => s.end() !== undefined)
    expect(s.end()).toMatchObject({
      reason: 'ended',
      error: { code: 'LOG_STREAM_ENDED', details: { exitCode: 0 } }
    })
    expect(s.delivered()).toHaveLength(20)
    expect(s.delivered().at(-1)?.process).toBe('systemd')
  })

  test('a stream ended by a signal (exit 129) is LOG_STREAM_ENDED too', async () => {
    const s = await startWith()
    s.stream.end(129)
    await waitFor(() => s.end() !== undefined)
    expect(s.end()).toMatchObject({ reason: 'ended', error: { code: 'LOG_STREAM_ENDED' } })
  })

  test('stop() ends it as stopped', async () => {
    const s = await startWith()
    await s.session.stop()
    expect(s.end()).toEqual({ reason: 'stopped' })
    expect(s.stream.stopped).toBe(true)
  })

  test('the caller’s signal ends it as stopped', async () => {
    const controller = new AbortController()
    const s = await startWith({ signal: controller.signal })
    controller.abort()
    await waitFor(() => s.end() !== undefined)
    expect(s.end()).toEqual({ reason: 'stopped' })
    expect(s.stream.stopped).toBe(true)
  })

  test('until: the first later entry ends it, matching or not, and is not delivered', async () => {
    const s = await startWith({ filter: { app: PLAYER, until: '2026-11-08T07:27:00.300Z' } }, '')
    s.stream.emit('a line without a header\n')
    s.stream.emit(FOLLOW)
    await waitFor(() => s.end() !== undefined)
    expect(s.end()).toEqual({ reason: 'until' })
    const delivered = s.delivered()
    expect(delivered.at(-1)?.message).toContain('Volta:console.error: player error tick 1')
    expect(delivered.every((e) => !e.message.includes('tick 2'))).toBe(true)
    expect(s.stream.stopped).toBe(true)
  })

  test('until by the clock', async () => {
    const s = await startWith({ filter: { until: '2026-11-08T12:00:03Z' } })
    await vi.advanceTimersByTimeAsync(2_999)
    expect(s.end()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    await waitFor(() => s.end() !== undefined)
    expect(s.end()).toEqual({ reason: 'until' })
  })

  test('an until 180 days ahead does not fire early', async () => {
    const until = new Date(NOW.getTime() + 180 * 86_400_000).toISOString()
    const s = await startWith({ filter: { until } })
    await vi.advanceTimersByTimeAsync(1)
    expect(s.end()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(25 * 86_400_000)
    expect(s.end()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(155 * 86_400_000)
    await waitFor(() => s.end() !== undefined)
    expect(s.end()).toEqual({ reason: 'until' })
  })

  test('an until already past prints the backlog up to it, then ends at a later entry', async () => {
    const s = await startWith({ filter: { until: '2026-11-08T07:27:00.000Z' } })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(s.end()).toBeUndefined()
    s.stream.emit(FOLLOW.split('\n').slice(1).join('\n'))
    await waitFor(() => s.end() !== undefined)
    expect(s.end()).toEqual({ reason: 'until' })
    expect(s.delivered()).toHaveLength(31)
  })

  test('setFilter re-filters without restarting the stream', async () => {
    const s = await startWith({}, FOLLOW)
    await vi.advanceTimersByTimeAsync(250)
    expect(s.session.entries()).toHaveLength(243)
    s.session.setFilter({ app: PLAYER, level: 'e' })
    expect(s.session.entries().map((e) => e.level)).toEqual(['E', 'E'])
    expect(s.session.counts()).toEqual({ lines: 243, errors: expect.any(Number), shown: 2 })
    expect(() => s.session.setFilter({ level: 'loud' })).toThrow(
      expect.objectContaining({ code: 'INVALID_LOG_FILTER' })
    )
    expect(s.runner.count(LOG)).toBe(1)
    expect(s.session.apps()).toContain(PLAYER)
    await s.session.stop()
  })

  test('clear empties the buffer and the counts', async () => {
    const s = await startWith({}, FOLLOW)
    await vi.advanceTimersByTimeAsync(250)
    s.session.clear()
    expect(s.session.counts()).toEqual({ lines: 0, errors: 0, shown: 0 })
    expect(s.session.entries()).toEqual([])
    await s.session.stop()
  })

  test('the idle flush delivers a held last entry', async () => {
    const s = await startWith()
    expect(s.delivered()).toEqual([])
    await vi.advanceTimersByTimeAsync(249)
    expect(s.delivered()).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(s.delivered()).toHaveLength(1)
    await s.session.stop()
  })

  test('the ring keeps the latest 100,000 entries', async () => {
    const s = await startWith({}, '')
    const lines = Array.from({ length: 100_050 }, (_, i) =>
      FLOOD_LINE.replace('player flood 287', `player flood ${i}`)
    )
    s.stream.emit(lines.join('\n') + '\n')
    await vi.advanceTimersByTimeAsync(250)
    const entries = s.session.entries()
    expect(entries).toHaveLength(100_000)
    expect(entries[0]?.message).toContain('player flood 50')
    expect(s.session.counts()).toMatchObject({ lines: 100_050, shown: 100_000 })
    await s.session.stop()
  })

  test('5,000 lines a second for 10 s are parsed and counted', async () => {
    const s = await startWith({ filter: { app: PLAYER } }, '')
    let n = 0
    for (let tick = 0; tick < 1_000; tick++) {
      const batch: string[] = []
      for (let i = 0; i < 50; i++) {
        batch.push(FLOOD_LINE.replace('player flood 287', `player flood ${n++}`))
      }
      s.stream.emit(batch.join('\n') + '\n')
      await vi.advanceTimersByTimeAsync(10)
    }
    await vi.advanceTimersByTimeAsync(250)
    expect(s.delivered()).toHaveLength(50_000)
    expect(s.delivered().at(-1)?.message).toContain('player flood 49999')
    expect(s.session.counts()).toEqual({ lines: 50_000, errors: 0, shown: 50_000 })
    await s.session.stop()
  })
})
