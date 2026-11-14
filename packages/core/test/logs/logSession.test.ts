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
import {
  createLogs,
  type LogsDeps,
  RECONNECT_POLL_MS,
  RECONNECT_TIMEOUT_MS
} from '../../src/logs/logSession.js'
import { createFakeFeed, type FakeFeed } from '../support/fakeFeed.js'
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
  logsDiscover?: () => Promise<never>,
  installed?: LogsDeps['installed']
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
  const feed = createFakeFeed()
  const logs = createLogs({
    runner,
    sdk: logsSdk,
    devices,
    activity,
    feed,
    ...(installed ? { installed } : {}),
    now: () => new Date()
  })
  return { logs, runner, feed }
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

// The session's start waits on real file I/O (the activity log), which a slow CI runner can
// take longer than a fixed number of event-loop turns to finish. So the budget is real time,
// read from `process.hrtime`, which the fake timers leave alone.
const WAIT_BUDGET_NS = 5_000_000_000n

async function waitFor(condition: () => boolean): Promise<void> {
  const started = process.hrtime.bigint()
  while (process.hrtime.bigint() - started < WAIT_BUDGET_NS) {
    if (condition()) return
    await settle()
  }
  if (condition()) return
  throw new Error('waitFor: condition never held')
}

// Moves the fake clock in small steps until the condition holds, within the same real-time
// budget. A reconnect poll arms its next timer only after its target read (real file I/O) is
// done, which on a slow runner can come after one big `advanceTimersByTimeAsync`: that timer
// would then never fire. Small steps keep advancing until it has.
const ADVANCE_STEP_MS = 100

async function advanceUntil(condition: () => boolean): Promise<void> {
  const started = process.hrtime.bigint()
  while (process.hrtime.bigint() - started < WAIT_BUDGET_NS) {
    if (condition()) return
    await vi.advanceTimersByTimeAsync(ADVANCE_STEP_MS)
    await settle()
  }
  if (condition()) return
  throw new Error('advanceUntil: condition never held')
}

interface Started {
  session: LogSession
  stream: FakeStream
  streams: FakeStream[]
  runner: FakeRunner
  feed: FakeFeed
  batches: { entries: LogEntry[]; counts: LogCounts; apps: string[] }[]
  delivered: () => LogEntry[]
  ovd: () => string[]
  end: () => LogSessionEnd | undefined
}

// Starts a session on the stick and emits `first` to get it running. `streams` are the
// `loggingctl` runs in order, one per call; `script` replaces commands of `online`.
async function startWith(
  opts: Omit<LogStartOptions, 'onEntries'> = {},
  first = `${FOLLOW.split('\n')[0] ?? ''}\n`,
  {
    streams = [new FakeStream()],
    script = {},
    installed
  }: {
    streams?: FakeStream[]
    script?: ConstructorParameters<typeof FakeRunner>[0]
    installed?: LogsDeps['installed']
  } = {}
): Promise<Started> {
  const [stream = new FakeStream()] = streams
  const { logs, runner, feed } = setup(
    { ...online, ...script, [LOG]: streams },
    undefined,
    undefined,
    installed
  )
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
  const delivered = () => batches.flatMap((b) => b.entries)
  return {
    session,
    stream,
    streams,
    runner,
    feed,
    batches,
    delivered,
    ovd: () =>
      delivered()
        .filter((e) => e.ovd !== undefined)
        .map((e) => e.message),
    end: () => ended
  }
}

const installOn = (target: string, over: Partial<ActivityEntry> = {}) =>
  ({
    action: 'app.install',
    target,
    surface: 'desktop',
    args: { package: 'player_armv7.vpkg' },
    ...over
  }) as const

const streamsOf = (n: number) => Array.from({ length: n }, () => new FakeStream())

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
    expect(s.session.counts()).toEqual({
      lines: 243,
      errors: expect.any(Number),
      shown: 2,
      oldest: '2026-11-08T07:26:59.934Z'
    })
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
    expect(s.session.counts()).toEqual({
      lines: 50_000,
      errors: 0,
      shown: 50_000,
      oldest: '2026-11-08T07:27:01.314Z'
    })
    await s.session.stop()
  })
})

describe('restart after install', () => {
  test('an install on the target stops the stream, starts another and adds install then restarted', async () => {
    const s = await startWith({}, undefined, { streams: streamsOf(2) })
    const [s1, s2] = s.streams as [FakeStream, FakeStream]
    s.feed.emit(installOn(STICK))
    expect(s1.stopped).toBe(true)
    await waitFor(() => s2.spec !== undefined)
    expect(s.runner.count(LOG)).toBe(2)
    s2.emit(FOLLOW)
    await vi.advanceTimersByTimeAsync(250)
    expect(s.ovd()).toEqual([
      'Installed player_armv7.vpkg from the desktop',
      'Log session restarted'
    ])
    const delivered = s.delivered()
    const restarted = delivered.findIndex((e) => e.message === 'Log session restarted')
    const firstDevice = delivered.findIndex((e) => e.ovd === undefined)
    expect(restarted).toBeLessThan(firstDevice)
    expect(delivered.filter((e) => e.ovd === undefined)).toHaveLength(243)
    await s.session.stop()
    expect(s2.stopped).toBe(true)
    expect(await activity()).toEqual([
      { action: 'logs', target: STICK, args: {}, result: 'ok' },
      { action: 'logs.restart', target: STICK, args: { reason: 'install' }, result: 'ok' }
    ])
  })

  test('onRestart is called once the restarted stream has started, not before', async () => {
    const restarts: string[] = []
    const s = await startWith({ onRestart: (reason) => restarts.push(reason) }, undefined, {
      streams: streamsOf(2)
    })
    const [, s2] = s.streams as [FakeStream, FakeStream]
    s.feed.emit(installOn(STICK))
    await waitFor(() => s2.spec !== undefined)
    expect(restarts).toEqual([])
    s2.emit(FOLLOW)
    expect(restarts).toEqual(['install'])
    await s.session.stop()
  })

  test.each(['start option', 'setRestartAfterInstall'] as const)(
    'with restartAfterInstall off (%s) only the install line is added',
    async (how) => {
      const s = await startWith(how === 'start option' ? { restartAfterInstall: false } : {})
      if (how === 'setRestartAfterInstall') s.session.setRestartAfterInstall(false)
      s.feed.emit(installOn(STICK))
      for (let i = 0; i < 20; i++) await settle()
      expect(s.stream.stopped).toBe(false)
      expect(s.runner.count(LOG)).toBe(1)
      expect(s.ovd()).toEqual(['Installed player_armv7.vpkg from the desktop'])
      await s.session.stop()
      expect(await activity()).toHaveLength(1)
    }
  )

  test('a failed install adds its line and never restarts', async () => {
    const s = await startWith()
    s.feed.emit(installOn(STICK, { surface: 'cli', result: 'error', errorCode: 'INSTALL_FAILED' }))
    for (let i = 0; i < 20; i++) await settle()
    expect(s.stream.stopped).toBe(false)
    expect(s.runner.count(LOG)).toBe(1)
    expect(s.ovd()).toEqual(['Install of player_armv7.vpkg failed: INSTALL_FAILED'])
    await s.session.stop()
  })

  test('another target’s install, logs, logs.restart and app.uninstall entries are ignored', async () => {
    const s = await startWith()
    s.feed.emit(installOn('VirtualDevice'))
    s.feed.emit({ action: 'logs', target: STICK })
    s.feed.emit({ action: 'logs.restart', target: STICK, args: { reason: 'install' } })
    s.feed.emit({ action: 'app.uninstall', target: STICK, args: { app: PLAYER } })
    for (let i = 0; i < 20; i++) await settle()
    expect(s.ovd()).toEqual([])
    expect(s.stream.stopped).toBe(false)
    expect(s.runner.count(LOG)).toBe(1)
    await s.session.stop()
  })

  test('installs during a restart are coalesced into one more restart', async () => {
    const s = await startWith({}, undefined, { streams: streamsOf(3) })
    const [, s2, s3] = s.streams as [FakeStream, FakeStream, FakeStream]
    s.feed.emit(installOn(STICK))
    s.feed.emit(installOn(STICK))
    await waitFor(() => s2.spec !== undefined)
    s.feed.emit(installOn(STICK))
    s2.emit(FOLLOW.split('\n').slice(0, 2).join('\n') + '\n')
    await waitFor(() => s3.spec !== undefined)
    expect(s2.stopped).toBe(true)
    s3.emit(FOLLOW)
    await vi.advanceTimersByTimeAsync(250)
    expect(s.runner.count(LOG)).toBe(3)
    expect(s.ovd()).toEqual([
      'Installed player_armv7.vpkg from the desktop',
      'Installed player_armv7.vpkg from the desktop',
      'Installed player_armv7.vpkg from the desktop',
      'Log session restarted',
      'Log session restarted'
    ])
    await s.session.stop()
  })

  test('an install while the first stream starts is not missed', async () => {
    const [s1, s2] = streamsOf(2) as [FakeStream, FakeStream]
    const { logs, runner, feed } = setup({ ...online, [LOG]: [s1, s2] })
    const batches: LogEntry[] = []
    const starting = logs.start({ onEntries: (entries) => batches.push(...entries) })
    await waitFor(() => s1.spec !== undefined)
    expect(feed.subscribers()).toBe(1)
    feed.emit(installOn(STICK))
    expect(batches.map((e) => e.message)).toEqual(['Installed player_armv7.vpkg from the desktop'])
    s1.emit(FOLLOW)
    const session = await starting
    await waitFor(() => s2.spec !== undefined)
    expect(s1.stopped).toBe(true)
    s2.emit(FOLLOW)
    await vi.advanceTimersByTimeAsync(250)
    expect(runner.count(LOG)).toBe(2)
    expect(batches.filter((e) => e.message === 'Log session restarted')).toHaveLength(1)
    await session.stop()
    expect(feed.subscribers()).toBe(0)
  })

  test('a failed first start leaves no feed subscriber', async () => {
    const stream = new FakeStream()
    const { logs, feed } = setup({ ...online, [LOG]: stream })
    const starting = logs.start()
    await waitFor(() => stream.spec !== undefined)
    expect(feed.subscribers()).toBe(1)
    stream.end(0)
    await expect(starting).rejects.toMatchObject({ code: 'LOG_STREAM_ENDED' })
    expect(feed.subscribers()).toBe(0)
  })

  test('launch verified, crashed and not-running lines', async () => {
    const s = await startWith()
    s.feed.emit({ action: 'app.launch', target: STICK, args: { app: PLAYER } })
    s.feed.emit({
      action: 'app.restart',
      target: STICK,
      args: { app: PLAYER, reason: 'crashed', pid: '27178', signal: 'SIGABRT' },
      result: 'error',
      errorCode: 'LAUNCH_NOT_VERIFIED'
    })
    s.feed.emit({
      action: 'app.launch',
      target: STICK,
      args: { app: PLAYER, reason: 'not-running' },
      result: 'error',
      errorCode: 'LAUNCH_NOT_VERIFIED'
    })
    expect(s.ovd()).toEqual([
      'Launch of com.example.player verified',
      'Crash detected: com.example.player (pid 27178, SIGABRT)',
      'Launch of com.example.player not verified: it isn’t running'
    ])
    expect(s.runner.count(LOG)).toBe(1)
    await s.session.stop()
  })

  test('a build change on the target is an OVD line, restarts nothing; another target’s is not shown', async () => {
    const s = await startWith()
    s.feed.emit({
      action: 'build.changed',
      target: STICK,
      args: { folder: 'build/armv7-release/', file: 'player_armv7.vpkg', redeploy: true }
    })
    s.feed.emit({
      action: 'build.changed',
      target: 'VirtualDevice',
      args: { folder: 'build/aarch64-debug/', file: 'player_aarch64.vpkg', redeploy: true }
    })
    expect(s.ovd()).toEqual(['Build folder changed: build/armv7-release/player_armv7.vpkg'])
    expect(s.runner.count(LOG)).toBe(1)
    await s.session.stop()
  })

  test('OVD lines match every filter, count in shown only and seq keeps increasing across a restart', async () => {
    const s = await startWith({ filter: { app: PLAYER, level: 'error' } }, FOLLOW, {
      streams: streamsOf(2)
    })
    await vi.advanceTimersByTimeAsync(250)
    const [, s2] = s.streams as [FakeStream, FakeStream]
    s.feed.emit(installOn(STICK))
    await waitFor(() => s2.spec !== undefined)
    // The new stream prints the same backlog again: it is dropped.
    s2.emit(FOLLOW)
    await vi.advanceTimersByTimeAsync(250)
    expect(s.delivered().map((e) => e.message)).toEqual([
      '[KeplerScript-JavaScript] player error tick 1',
      '[KeplerScript-JavaScript] player error tick 2',
      'Installed player_armv7.vpkg from the desktop',
      'Log session restarted'
    ])
    expect(s.session.counts()).toEqual({
      lines: 243,
      errors: expect.any(Number),
      shown: 4,
      oldest: '2026-11-08T07:26:59.934Z'
    })
    const seqs = s.session.entries().map((e) => e.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(new Set(seqs).size).toBe(seqs.length)
    s.session.setFilter({})
    const all = s.session.entries().map((e) => e.seq)
    expect(all).toEqual(Array.from({ length: 245 }, (_, i) => i))
    await s.session.stop()
  })

  test.each([[undefined], [0]])(
    'after a restart the Virtual Device backlog is dropped: exactly the 127 lines past line 573 of restart-after, none twice (capacity %s)',
    async (capacity) => {
      const before = fixture('0.24/loggingctl-log/virtual-device-restart-before.txt')
      const after = fixture('0.24/loggingctl-log/virtual-device-restart-after.txt')
      const s = await startWith(capacity === undefined ? {} : { capacity }, '', {
        streams: streamsOf(2)
      })
      const [s1, s2] = s.streams as [FakeStream, FakeStream]
      s1.emit(before)
      await vi.advanceTimersByTimeAsync(250)
      expect(s.delivered()).toHaveLength(573)
      s.feed.emit(installOn(STICK))
      await waitFor(() => s2.spec !== undefined)
      for (const chunk of thirds(after)) s2.emit(chunk)
      await vi.advanceTimersByTimeAsync(250)
      const delivered = s.delivered()
      const restarted = delivered.findIndex((e) => e.message === 'Log session restarted')
      const expected = after
        .split('\n')
        .slice(573, 700)
        .map((line) => line.replace(/^.*?: (?:\d+ )?/, ''))
      const newer = delivered.slice(restarted + 1)
      expect(newer).toHaveLength(127)
      newer.forEach((e, i) => expect(expected[i]).toContain(e.message))
      const keys = delivered
        .filter((e) => e.ovd === undefined)
        .map((e) => `${e.deviceTime ?? ''}|${e.process ?? ''}|${e.pid ?? ''}|${e.message}`)
      expect(keys).toHaveLength(700)
      expect(new Set(keys).size).toBe(700)
      await s.session.stop()
    }
  )
})

describe('reconnect', () => {
  const none = out('vda-devices/none.txt')
  const stick = out('vda-devices/stick-usb.txt')

  test('a self-ended stream reconnects once the target is back', async () => {
    const states: string[] = []
    const restarts: string[] = []
    const s = await startWith(
      {
        onState: (state) => states.push(state),
        onRestart: (reason) => restarts.push(reason)
      },
      REBOOT,
      {
        streams: streamsOf(2),
        script: { [VDA]: [stick, none, none, stick] }
      }
    )
    const [s1, s2] = s.streams as [FakeStream, FakeStream]
    s1.end(0)
    await waitFor(() => s.session.state() === 'reconnecting')
    expect(states).toEqual(['reconnecting'])
    expect(s.ovd()).toEqual(['Device dropped · reconnecting…'])
    expect(s.delivered().filter((e) => e.ovd === undefined)).toHaveLength(20)
    // Polls are RECONNECT_POLL_MS apart, so the count passes through every value.
    for (const calls of [2, 3]) {
      await advanceUntil(() => s.runner.count(VDA) === calls)
      expect(s.runner.count(LOG)).toBe(1)
    }
    await advanceUntil(() => s2.spec !== undefined)
    expect(s.runner.count(LOG)).toBe(2)
    s2.emit(FOLLOW)
    await vi.advanceTimersByTimeAsync(250)
    expect(s.session.state()).toBe('following')
    expect(states).toEqual(['reconnecting', 'following'])
    expect(restarts).toEqual(['reconnect'])
    expect(s.ovd()).toEqual(['Device dropped · reconnecting…', 'Log session reconnected'])
    const seqs = s.delivered().map((e) => e.seq)
    expect(seqs).toEqual(Array.from({ length: 20 + 2 + 243 }, (_, i) => i))
    expect(s.end()).toBeUndefined()
    await s.session.stop()
    expect(await activity()).toEqual([
      { action: 'logs', target: STICK, args: {}, result: 'ok' },
      { action: 'logs.restart', target: STICK, args: { reason: 'reconnect' }, result: 'ok' }
    ])
  })

  test('gives up after three streams in a row that end at once', async () => {
    const s = await startWith({}, undefined, { streams: streamsOf(3) })
    const [s1, s2, s3] = s.streams as [FakeStream, FakeStream, FakeStream]
    s1.end(129)
    await waitFor(() => s.session.state() === 'reconnecting')
    await advanceUntil(() => s2.spec !== undefined)
    s2.end(129)
    await advanceUntil(() => s3.spec !== undefined)
    s3.end(129)
    await waitFor(() => s.end() !== undefined)
    expect(s.end()).toMatchObject({
      reason: 'ended',
      error: { code: 'LOG_STREAM_ENDED', details: { exitCode: 129 } }
    })
    expect(s.ovd()).toEqual(['Device dropped · reconnecting…'])
    expect(s.runner.count(LOG)).toBe(3)
    expect(await activity()).toEqual([
      { action: 'logs', target: STICK, args: {}, result: 'ok' },
      {
        action: 'logs.restart',
        target: STICK,
        args: { reason: 'reconnect' },
        result: 'error',
        errorCode: 'LOG_STREAM_ENDED'
      }
    ])
  })

  test('gives up after RECONNECT_TIMEOUT_MS with the target away', async () => {
    const s = await startWith({}, REBOOT, { script: { [VDA]: [stick, none] } })
    s.stream.end(0)
    await waitFor(() => s.session.state() === 'reconnecting')
    await vi.advanceTimersByTimeAsync(RECONNECT_TIMEOUT_MS - 1)
    for (let i = 0; i < 20; i++) await settle()
    expect(s.end()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    await waitFor(() => s.end() !== undefined)
    expect(s.end()).toMatchObject({
      reason: 'ended',
      error: { code: 'LOG_STREAM_ENDED', details: { exitCode: 0 } }
    })
    expect(s.runner.count(LOG)).toBe(1)
    expect(await activity()).toContainEqual({
      action: 'logs.restart',
      target: STICK,
      args: { reason: 'reconnect' },
      result: 'error',
      errorCode: 'LOG_STREAM_ENDED'
    })
  })

  test('stop during reconnecting ends as stopped with no stream started and no feed subscriber', async () => {
    const s = await startWith({}, REBOOT, { script: { [VDA]: [stick, none] } })
    s.stream.end(0)
    await waitFor(() => s.session.state() === 'reconnecting')
    await s.session.stop()
    expect(s.end()).toEqual({ reason: 'stopped' })
    expect(s.feed.subscribers()).toBe(0)
    await vi.advanceTimersByTimeAsync(RECONNECT_POLL_MS * 3)
    for (let i = 0; i < 20; i++) await settle()
    expect(s.runner.count(LOG)).toBe(1)
    expect(s.runner.count(VDA)).toBe(1)
  })
})

describe('boot tagging', () => {
  const BOOT = `vega exec vda -s ${STICK} shell cat /proc/sys/kernel/random/boot_id`
  // Sample IDs (ADR 0016), as the device prints them (dashed) and as core keeps them.
  const ID_A = '0b6a5f2e-3c41-4d7a-9e58-1f2a3b4c5d6e'
  const ID_B = '7d1c9a40-52be-4f0e-8a6b-99c0d1e2f3a4'
  const bare = (id: string) => id.replaceAll('-', '')
  const bootOut = (id: string) => ({ stdout: `${id}\n`, exitCode: 0 })
  const device = (s: Started) => s.delivered().filter((e) => e.ovd === undefined)

  test('is on by default: the boot command runs once and the entries carry the boot', async () => {
    const s = await startWith({}, FOLLOW, { script: { [BOOT]: bootOut(ID_A) } })
    expect(s.runner.count(BOOT)).toBe(1)
    expect(device(s).every((e) => e.boot === bare(ID_A))).toBe(true)
  })

  test('with tagBoot false there is no boot command and no tag', async () => {
    const s = await startWith({ tagBoot: false })
    expect(s.runner.count(BOOT)).toBe(0)
    expect(device(s).every((e) => e.boot === undefined)).toBe(true)
  })

  test('with tagBoot the stream’s entries carry the boot ID, read once before the stream', async () => {
    const s = await startWith({ tagBoot: true }, FOLLOW, { script: { [BOOT]: bootOut(ID_A) } })
    expect(s.runner.count(BOOT)).toBe(1)
    // The command is the fixed one, with no user input in it.
    const spec = s.runner.calls.find((c) => c.display === BOOT)
    expect(spec?.args).toEqual([
      'exec',
      'vda',
      '-s',
      STICK,
      'shell',
      'cat',
      '/proc/sys/kernel/random/boot_id'
    ])
    // It ran before the stream started.
    expect(s.runner.calls.findIndex((c) => c.display === BOOT)).toBeLessThan(
      s.runner.calls.findIndex((c) => c.display === LOG)
    )
    expect(device(s).length).toBeGreaterThan(100)
    expect(device(s).every((e) => e.boot === bare(ID_A))).toBe(true)
    expect(s.session.entries().every((e) => e.ovd !== undefined || e.boot === bare(ID_A))).toBe(
      true
    )
    expect(s.ovd()).toEqual([])
  })

  test('a reconnect after a reboot reads the boot ID again: each stream keeps its own', async () => {
    const s = await startWith({ tagBoot: true }, REBOOT, {
      streams: streamsOf(2),
      script: {
        [VDA]: [
          out('vda-devices/stick-usb.txt'),
          out('vda-devices/none.txt'),
          out('vda-devices/stick-usb.txt')
        ],
        [BOOT]: [bootOut(ID_A), bootOut(ID_B)]
      }
    })
    const [s1, s2] = s.streams as [FakeStream, FakeStream]
    s1.end(0)
    await waitFor(() => s.session.state() === 'reconnecting')
    await advanceUntil(() => s2.spec !== undefined)
    expect(s.runner.count(BOOT)).toBe(2)
    s2.emit(FOLLOW)
    await vi.advanceTimersByTimeAsync(250)
    expect(s.session.state()).toBe('following')
    const boots = new Set(device(s).map((e) => e.boot))
    expect(boots).toEqual(new Set([bare(ID_A), bare(ID_B)]))
    // Every entry before the reconnect line is boot A, every one after it boot B.
    const all = s.delivered()
    const at = all.findIndex((e) => e.ovd?.kind === 'reconnected')
    expect(all.slice(0, at).every((e) => e.boot === undefined || e.boot === bare(ID_A))).toBe(true)
    expect(all.slice(at).every((e) => e.ovd !== undefined || e.boot === bare(ID_B))).toBe(true)
    await s.session.stop()
  })

  test.each([
    ['a failing command', { exitCode: 1, stderr: 'cat: no such file' }],
    ['output that isn’t a UUID', { stdout: 'not a boot id\n', exitCode: 0 }],
    ['an empty answer', { stdout: '', exitCode: 0 }],
    ['a runner error', new OvdError('COMMAND_FAILED', 'The command could not run', 'Try again')]
  ])('a failed read (%s) is harmless: no tag, no error, no line', async (_name, result) => {
    const s = await startWith({ tagBoot: true }, FOLLOW, { script: { [BOOT]: result } })
    expect(device(s).length).toBeGreaterThan(100)
    expect(device(s).every((e) => e.boot === undefined)).toBe(true)
    expect(s.ovd()).toEqual([])
    expect(s.end()).toBeUndefined()
    await s.session.stop()
    expect(await activity()).toEqual([{ action: 'logs', target: STICK, args: {}, result: 'ok' }])
  })

  test('a boot filter turns the read on by itself and shows only that boot', async () => {
    const s = await startWith({ filter: { boot: [ID_A] } }, FOLLOW, {
      script: { [BOOT]: bootOut(ID_A) }
    })
    expect(s.runner.count(BOOT)).toBe(1)
    expect(device(s).length).toBeGreaterThan(100)
    expect(s.delivered().every((e) => e.ovd !== undefined || e.boot === bare(ID_A))).toBe(true)
  })

  test('a boot filter for another boot shows no device line', async () => {
    const s = await startWith({ filter: { boot: [ID_B] } }, FOLLOW, {
      script: { [BOOT]: bootOut(ID_A) }
    })
    expect(device(s)).toEqual([])
    expect(s.session.counts().lines).toBeGreaterThan(100)
    expect(s.session.counts().shown).toBe(0)
  })

  test('a boot filter with a failed read: one OVD line says the boot ID is unknown', async () => {
    const s = await startWith({ filter: { boot: ['current'] } }, FOLLOW, {
      script: { [BOOT]: { exitCode: 1 } }
    })
    expect(device(s)).toEqual([])
    expect(s.ovd()).toEqual(['Boot ID unknown: the boot filter shows no device lines'])
    expect(s.end()).toBeUndefined()
  })

  test('boot current is the running stream’s boot: it follows a reboot', async () => {
    const s = await startWith({ tagBoot: true, filter: { boot: ['current'] } }, REBOOT, {
      streams: streamsOf(2),
      script: {
        [VDA]: [
          out('vda-devices/stick-usb.txt'),
          out('vda-devices/none.txt'),
          out('vda-devices/stick-usb.txt')
        ],
        [BOOT]: [bootOut(ID_A), bootOut(ID_B)]
      }
    })
    const [s1, s2] = s.streams as [FakeStream, FakeStream]
    s1.end(0)
    await waitFor(() => s.session.state() === 'reconnecting')
    await advanceUntil(() => s2.spec !== undefined)
    s2.emit(FOLLOW)
    await vi.advanceTimersByTimeAsync(250)
    // The buffer is judged again against the new boot: boot A's lines are no longer `current`.
    const shown = s.session.entries().filter((e) => e.ovd === undefined)
    expect(shown.length).toBeGreaterThan(100)
    expect(shown.every((e) => e.boot === bare(ID_B))).toBe(true)
    expect(s.session.counts().shown).toBe(s.session.entries().length)
    await s.session.stop()
  })

  test('setFilter with a boot filter on a session that opted out of tags reads the boot ID once, then tags', async () => {
    const s = await startWith({ tagBoot: false }, FOLLOW, { script: { [BOOT]: bootOut(ID_A) } })
    expect(s.runner.count(BOOT)).toBe(0)
    s.session.setFilter({ boot: ['current'] })
    await waitFor(() => s.ovd().length > 0)
    expect(s.runner.count(BOOT)).toBe(1)
    // One line says the buffered entries stay unmatched.
    expect(s.ovd()).toEqual([
      'Boot filter on: lines received before have no boot ID and stay hidden'
    ])
    expect(s.session.entries().filter((e) => e.ovd === undefined)).toEqual([])
    // Later entries of the stream carry the boot and match `current`.
    s.stream.emit(`${FOLLOW.split('\n')[0] ?? ''}\n`)
    await vi.advanceTimersByTimeAsync(250)
    const shown = s.session.entries().filter((e) => e.ovd === undefined)
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.every((e) => e.boot === bare(ID_A))).toBe(true)
    // Setting a boot filter again doesn't read again.
    s.session.setFilter({ boot: [ID_A] })
    await settle()
    expect(s.runner.count(BOOT)).toBe(1)
    await s.session.stop()
  })

  test('a boot filter set later whose read fails says the boot ID is unknown, once', async () => {
    const s = await startWith({}, FOLLOW, { script: { [BOOT]: { exitCode: 1 } } })
    s.session.setFilter({ boot: ['current'] })
    await waitFor(() => s.ovd().length > 0)
    expect(s.ovd()).toEqual(['Boot ID unknown: the boot filter shows no device lines'])
    await s.session.stop()
  })

  test('a boot filter set later keeps the next streams tagged', async () => {
    const s = await startWith({}, FOLLOW, {
      streams: streamsOf(2),
      script: { [BOOT]: [bootOut(ID_A), bootOut(ID_B)] }
    })
    s.session.setFilter({ boot: ['current'] })
    await waitFor(() => s.runner.count(BOOT) === 1)
    s.feed.emit(installOn(STICK))
    const s2 = s.streams[1] as FakeStream
    await waitFor(() => s2.spec !== undefined)
    expect(s.runner.count(BOOT)).toBe(2)
    await s.session.stop()
  })

  test('setFilter with a boot filter after a failed tagged read says the boot is unknown', async () => {
    const s = await startWith({ tagBoot: true }, FOLLOW, { script: { [BOOT]: { exitCode: 1 } } })
    s.session.setFilter({ boot: ['current'] })
    expect(s.ovd()).toEqual(['Boot ID unknown: the boot filter shows no device lines'])
    expect(s.session.entries().filter((e) => e.ovd === undefined)).toEqual([])
    s.session.setFilter({})
    expect(s.session.entries().filter((e) => e.ovd === undefined).length).toBeGreaterThan(0)
  })

  test('an invalid boot filter is a usage error before any SDK call', async () => {
    const { logs, runner } = setup({ ...online })
    await expect(logs.start({ filter: { boot: ['nope'] } })).rejects.toMatchObject({
      code: 'INVALID_LOG_FILTER'
    })
    expect(runner.calls).toEqual([])
  })
})

describe('advanced filters and rules in a session', () => {
  test('the new fields never reach a device command', async () => {
    const s = await startWith({
      filter: {
        pid: [27178],
        tid: [1],
        tag: ['com.amazon.keplerscript'],
        identity: [PLAYER],
        facility: ['local0'],
        processRules: [{ identity: PLAYER, rate: 5 }]
      }
    })
    for (const call of s.runner.calls) {
      expect(call.args.join(' ')).not.toMatch(/27178|keplerscript|local0|com\.example/)
    }
    await s.session.stop()
  })

  test('--pid filters the stream', async () => {
    const s = await startWith({ filter: { pid: [27178] } }, FOLLOW)
    const device = s.delivered().filter((e) => e.ovd === undefined)
    expect(device.length).toBeGreaterThan(2)
    expect(device.every((e) => e.pid === 27178)).toBe(true)
    await s.session.stop()
  })

  test('a rate rule: the lines over the rate are hidden, and stopping reports the open second', async () => {
    const s = await startWith({ filter: { processRules: [{ identity: PLAYER, rate: 1 }] } }, FOLLOW)
    await vi.advanceTimersByTimeAsync(250)
    const shown = s.delivered()
    const hidden = shown.filter((e) => e.ovd?.kind === 'rate-limited')
    // The player prints several lines in each of two device seconds.
    expect(hidden.map((e) => e.message)).toEqual([`${PLAYER}: 5 lines hidden by rate limit`])
    const player = shown.filter((e) => e.process === PLAYER)
    expect(player.length).toBe(2)
    const before = s.delivered().length
    await s.session.stop()
    const last = s.delivered().slice(before)
    expect(last.every((e) => e.ovd?.kind === 'rate-limited')).toBe(true)
    // What a re-filter gives is what streaming gave, the stop's lines included.
    s.session.setFilter({ processRules: [{ identity: PLAYER, rate: 1 }] })
    expect(s.session.entries().map((e) => e.message)).toEqual(s.delivered().map((e) => e.message))
  })

  test('presets() lists the built-in presets', async () => {
    const { logs } = setup({ ...online })
    expect(logs.presets().map((p) => p.key)).toEqual(['all', 'app-errors', 'network', 'lifecycle'])
  })
})

describe('app-errors and the side-loaded apps', () => {
  const SYSTEM = 'com.amazon.keplerlauncherapp'
  const errorLine = (identity: string, i: number) =>
    `Nov 08 07:27:0${i}.100000 firestick-0000000000000001 local0.err ${identity}[500]: 600 ERROR com.amazon.keplerscript: [KeplerScript-JavaScript] boom ${i}\n`
  const lines = errorLine(PLAYER, 1) + errorLine(SYSTEM, 2)

  test('an installed system app’s errors are excluded once the listing is read', async () => {
    const installed = vi.fn(async () => [
      { packageId: PLAYER, source: 'sideloaded' as const },
      { packageId: SYSTEM, source: 'system' as const }
    ])
    const s = await startWith({ filter: { level: 'error', appsOnly: true } }, lines, { installed })
    await waitFor(() => installed.mock.calls.length > 0)
    await waitFor(() => s.session.entries().every((e) => e.process !== SYSTEM))
    expect(s.session.entries().map((e) => e.process)).toEqual([PLAYER])
    // One read per stream.
    s.stream.emit(errorLine(SYSTEM, 3))
    await vi.advanceTimersByTimeAsync(250)
    expect(installed).toHaveBeenCalledTimes(1)
    expect(s.session.entries().map((e) => e.process)).toEqual([PLAYER])
    await s.session.stop()
  })

  test('without an appsOnly filter the listing is never read', async () => {
    const installed = vi.fn(async () => [])
    const s = await startWith({}, lines, { installed })
    await settle()
    expect(installed).not.toHaveBeenCalled()
    await s.session.stop()
  })

  test('setFilter with appsOnly reads it then', async () => {
    const installed = vi.fn(async () => [{ packageId: PLAYER, source: 'sideloaded' as const }])
    const s = await startWith({}, lines, { installed })
    s.session.setFilter({ appsOnly: true })
    await waitFor(() => installed.mock.calls.length > 0)
    await waitFor(() => s.session.entries().every((e) => e.process !== SYSTEM))
    await s.session.stop()
  })

  // A listing that answers once `release` is called, for the order of the read and the stream.
  function gatedListing() {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const installed = vi.fn(async () => {
      await gate
      return [
        { packageId: PLAYER, source: 'sideloaded' as const },
        { packageId: SYSTEM, source: 'system' as const }
      ]
    })
    return { installed, release }
  }

  test('with appsOnly at the start, the list is read before the stream starts, so the backlog is judged with it', async () => {
    const { installed, release } = gatedListing()
    const stream = new FakeStream()
    const { logs } = setup({ ...online, [LOG]: [stream] }, undefined, undefined, installed)
    const shown: LogEntry[] = []
    const starting = logs.start({
      filter: { appsOnly: true },
      onEntries: (entries) => shown.push(...entries)
    })
    await waitFor(() => installed.mock.calls.length > 0)
    await settle()
    expect(stream.spec).toBeUndefined()
    release()
    await waitFor(() => stream.spec !== undefined)
    stream.emit(lines)
    const session = await starting
    await vi.advanceTimersByTimeAsync(250)
    // Delivered as they arrived, not only after a later re-evaluation.
    expect(shown.filter((e) => e.ovd === undefined).map((e) => e.process)).toEqual([PLAYER])
    expect(installed).toHaveBeenCalledTimes(1)
    await session.stop()
  })

  test('setFilter turning appsOnly on holds the arriving lines, in order, until the list is read', async () => {
    const { installed, release } = gatedListing()
    const s = await startWith({}, errorLine(PLAYER, 1) + errorLine(SYSTEM, 2), { installed })
    await vi.advanceTimersByTimeAsync(250)
    const before = s.delivered().length
    s.session.setFilter({ appsOnly: true })
    await waitFor(() => installed.mock.calls.length > 0)
    s.stream.emit(errorLine(PLAYER, 3) + errorLine(SYSTEM, 4) + errorLine(PLAYER, 5))
    await vi.advanceTimersByTimeAsync(250)
    // Nothing of them is delivered, or hidden for good, while the read is out.
    expect(s.delivered()).toHaveLength(before)
    release()
    await waitFor(() => s.delivered().length > before)
    const after = s.delivered().slice(before)
    expect(after.map((e) => e.message)).toEqual([
      expect.stringContaining('boom 3'),
      expect.stringContaining('boom 5')
    ])
    expect(s.session.entries().map((e) => e.process)).toEqual([PLAYER, PLAYER, PLAYER])
    await s.session.stop()
  })

  test('the hold is bounded: after 5 s the lines are judged fail-closed, and the buffer is re-evaluated when the list comes', async () => {
    const { installed, release } = gatedListing()
    const s = await startWith({}, errorLine(PLAYER, 1) + errorLine(SYSTEM, 2), { installed })
    await vi.advanceTimersByTimeAsync(250)
    s.session.setFilter({ appsOnly: true })
    await waitFor(() => installed.mock.calls.length > 0)
    s.stream.emit(errorLine(PLAYER, 3) + errorLine(SYSTEM, 4))
    await vi.advanceTimersByTimeAsync(250)
    const before = s.delivered().length
    await vi.advanceTimersByTimeAsync(5_000)
    // Released, and the set is still unknown: no device line shows.
    expect(
      s
        .delivered()
        .slice(before)
        .filter((e) => e.ovd === undefined)
    ).toEqual([])
    release()
    await waitFor(() => s.session.entries().some((e) => e.process === PLAYER))
    expect(s.session.entries().every((e) => e.process === PLAYER)).toBe(true)
    await s.session.stop()
  })

  test('a failed read fails closed: no line shows, one OVD line says why, the next stream retries', async () => {
    const installed = vi
      .fn<NonNullable<LogsDeps['installed']>>()
      .mockRejectedValueOnce(new OvdError('COMMAND_FAILED', 'could not read', 'Try again'))
      .mockResolvedValue([{ packageId: PLAYER, source: 'sideloaded' }])
    const s = await startWith({ filter: { appsOnly: true } }, lines, {
      installed,
      streams: streamsOf(2)
    })
    await waitFor(() => s.ovd().length > 0)
    await vi.advanceTimersByTimeAsync(250)
    expect(s.session.entries().filter((e) => e.ovd === undefined)).toEqual([])
    expect(s.ovd()).toEqual([
      'App list unavailable — App errors only shows nothing until it can be read'
    ])
    expect(s.end()).toBeUndefined()
    // An install restarts the stream, and the listing is read again.
    const s2 = s.streams[1] as FakeStream
    s.feed.emit(installOn(STICK))
    await waitFor(() => s2.spec !== undefined)
    s2.emit(lines)
    await waitFor(() => installed.mock.calls.length === 2)
    await vi.advanceTimersByTimeAsync(250)
    await waitFor(() => s.session.entries().some((e) => e.process === PLAYER))
    expect(s.session.entries().some((e) => e.process === SYSTEM)).toBe(false)
    await s.session.stop()
  })
})
