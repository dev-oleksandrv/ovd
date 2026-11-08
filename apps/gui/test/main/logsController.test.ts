// @vitest-environment node
import {
  LOG_BUFFER_SIZE,
  OvdError,
  type LogCounts,
  type LogEntry,
  type LogSession,
  type LogSessionEnd,
  type LogStartOptions,
  type Ovd
} from '@ovd/core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createLogsController } from '../../src/main/logsController'
import type { LogsUpdate } from '../../src/preload/api'
import { LOG_RING_SIZE } from '../../src/renderer/src/screens/logs/logStore'

const STICK = 'G070000000000001'
const VVD = 'VirtualDevice'

const entry = (seq: number, level: LogEntry['level'] = 'I'): LogEntry => ({
  seq,
  time: '2026-11-08T07:27:00.257Z',
  deviceTime: 'Nov 08 07:27:00.257342',
  level,
  priority: level === 'E' ? 'err' : 'info',
  facility: 'user',
  process: 'com.example.player',
  pid: 27178,
  tid: 2842092448,
  tag: 'com.amazon.keplerscript',
  message: `player tick ${seq}`,
  parsed: true
})

interface FakeSession {
  opts: LogStartOptions
  session: LogSession
  end(end: LogSessionEnd): void
  ended: () => LogSessionEnd | undefined
  setFilter: ReturnType<typeof vi.fn>
}

// A `logs.start` that resolves at once with a session holding `entries` (two by default).
function fakeLogs(opts: { failWith?: OvdError; entries?: number } = {}) {
  const sessions: FakeSession[] = []
  const start = vi.fn(async (start: LogStartOptions = {}): Promise<LogSession> => {
    if (opts.failWith) throw opts.failWith
    let finish: (end: LogSessionEnd) => void = () => undefined
    let ended: LogSessionEnd | undefined
    const done = new Promise<LogSessionEnd>((resolve) => {
      finish = (end) => {
        ended ??= end
        resolve(end)
      }
    })
    let entries =
      opts.entries === undefined
        ? [entry(0), entry(1, 'E')]
        : Array.from({ length: opts.entries }, (_, i) => entry(i))
    let counts: LogCounts =
      opts.entries === undefined
        ? { lines: 2, errors: 1, shown: 2 }
        : { lines: opts.entries, errors: 0, shown: opts.entries }
    const setFilter = vi.fn((input: { level?: string }) => {
      if (input.level === 'loud') {
        throw new OvdError('INVALID_LOG_FILTER', '--level "loud" isn’t a log level', 'hint')
      }
      if (input.level === 'e') {
        entries = entries.filter((e) => e.level === 'E')
        counts = { ...counts, shown: entries.length }
      }
    })
    const session: LogSession = {
      target: { id: start.device ?? STICK, name: 'Fire TV stick' },
      command: `vega exec vda -s ${start.device ?? STICK} shell loggingctl log -f -o short_concise`,
      startedAt: '2026-11-08T07:27:00.000Z',
      done,
      setFilter,
      entries: (through) => entries.filter((e) => through === undefined || e.seq <= through),
      counts: () => counts,
      apps: () => ['com.example.player'],
      clear: () => {
        entries = []
        counts = { lines: 0, errors: 0, shown: 0 }
      },
      stop: async () => finish({ reason: 'stopped' })
    }
    sessions.push({ opts: start, session, end: finish, ended: () => ended, setFilter })
    return session
  })
  return { logs: { start } as unknown as Ovd['logs'], start, sessions }
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))

function setup(opts: { failWith?: OvdError; entries?: number } = {}) {
  const fake = fakeLogs(opts)
  const sent: LogsUpdate[] = []
  const controller = createLogsController({ logs: fake.logs, send: (u) => sent.push(u) })
  return { ...fake, sent, controller }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('createLogsController', () => {
  test('open starts a session once per device and replays it on the next open', async () => {
    const { controller, start, sent } = setup()
    expect(await controller.open(STICK)).toEqual({
      status: 'starting',
      device: STICK,
      name: STICK
    })
    await settle()
    expect(sent.at(-2)).toEqual({
      kind: 'state',
      session: 1,
      state: {
        status: 'running',
        device: STICK,
        name: 'Fire TV stick',
        startedAt: '2026-11-08T07:27:00.000Z'
      }
    })
    expect(sent.at(-1)).toMatchObject({ kind: 'reset', session: 1, entries: { length: 2 } })
    sent.length = 0
    await controller.open(STICK)
    expect(start).toHaveBeenCalledTimes(1)
    expect(sent.map((u) => u.kind)).toEqual(['state', 'reset'])
    expect(controller.running()).toBe(true)
  })

  test('open for another device stops the old session and starts one with a new number', async () => {
    const { controller, start, sessions, sent } = setup()
    await controller.open(STICK)
    await settle()
    await controller.open(VVD)
    await settle()
    expect(start).toHaveBeenCalledTimes(2)
    expect(sessions[0]?.ended()).toEqual({ reason: 'stopped' })
    expect(sessions[1]?.opts.device).toBe(VVD)
    expect(sent.at(-1)).toMatchObject({ kind: 'reset', session: 2 })
  })

  test.each([
    ['another device', VVD],
    ['no target', null]
  ])('a target change to %s stops the session and goes idle', async (_n, target) => {
    const { controller, start, sessions, sent } = setup()
    await controller.open(STICK)
    await settle()
    await controller.targetChanged(target)
    expect(sessions[0]?.ended()).toEqual({ reason: 'stopped' })
    expect(sent.slice(-2)).toEqual([
      { kind: 'state', session: 2, state: { status: 'idle' } },
      {
        kind: 'reset',
        session: 2,
        entries: [],
        counts: { lines: 0, errors: 0, shown: 0 },
        apps: []
      }
    ])
    expect(controller.running()).toBe(false)
    await controller.open(VVD)
    await settle()
    expect(start).toHaveBeenCalledTimes(2)
    expect(sent.at(-1)).toMatchObject({ kind: 'reset', session: 3 })
  })

  test('a target change while the session is still starting stops it too', async () => {
    const { controller, sessions } = setup()
    await controller.open(STICK)
    await controller.targetChanged(VVD)
    await settle()
    expect(sessions[0]?.ended()).toEqual({ reason: 'stopped' })
    expect(controller.running()).toBe(false)
  })

  test('a target change to the session’s own device does nothing', async () => {
    const { controller, sessions, sent } = setup()
    await controller.open(STICK)
    await settle()
    const before = sent.length
    await controller.targetChanged(STICK)
    expect(sent).toHaveLength(before)
    expect(sessions[0]?.ended()).toBeUndefined()
  })

  test('a start error pushes ended with the error', async () => {
    const { controller, sent } = setup({
      failWith: new OvdError('TARGET_OFFLINE', 'Fire TV stick is offline', 'Plug it in')
    })
    await controller.open(STICK)
    await settle()
    expect(sent.at(-1)).toEqual({
      kind: 'state',
      session: 1,
      state: {
        status: 'ended',
        device: STICK,
        name: STICK,
        startedAt: null,
        error: { code: 'TARGET_OFFLINE', message: 'Fire TV stick is offline', hint: 'Plug it in' }
      }
    })
  })

  test('a stream that ends pushes ended and keeps its entries', async () => {
    const { controller, sessions, sent } = setup()
    await controller.open(STICK)
    await settle()
    sessions[0]?.end({
      reason: 'ended',
      error: new OvdError('LOG_STREAM_ENDED', 'Fire TV stick’s log stream ended', 'hint')
    })
    await settle()
    expect(sent.at(-1)).toMatchObject({
      kind: 'state',
      state: { status: 'ended', error: { code: 'LOG_STREAM_ENDED' } }
    })
    expect(controller.exportText()?.lines).toBe(2)
  })

  test('entries with no match still lead to an append with fresh counts', async () => {
    const { controller, sessions, sent } = setup()
    await controller.open(STICK)
    await settle()
    sessions[0]?.opts.onEntries?.([], { lines: 9, errors: 1, shown: 2 }, [])
    vi.advanceTimersByTime(100)
    expect(sent.at(-1)).toEqual({
      kind: 'append',
      session: 1,
      entries: [],
      counts: { lines: 9, errors: 1, shown: 2 },
      apps: []
    })
  })

  test('setFilter re-filters without restarting and pushes a reset', async () => {
    const { controller, start, sessions, sent } = setup()
    await controller.open(STICK)
    await settle()
    expect(await controller.setFilter({ level: 'e' })).toEqual({ ok: true, data: null })
    expect(sessions[0]?.setFilter).toHaveBeenCalledWith({ level: 'e' })
    expect(sent.at(-1)).toMatchObject({ kind: 'reset', entries: [{ level: 'E' }] })
    expect(start).toHaveBeenCalledTimes(1)
    await controller.restart(STICK)
    expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ filter: { level: 'e' } }))
  })

  test('setFilter on 12,001 entries goes out as a reset and two appends, then live entries', async () => {
    const { controller, sessions, sent } = setup({ entries: 12_001 })
    await controller.open(STICK)
    await settle()
    sent.length = 0

    await controller.setFilter({ search: 'tick' })

    expect(sent.map((u) => u.kind)).toEqual(['reset', 'append', 'append'])
    const seqs = sent.flatMap((u) => (u.kind === 'state' ? [] : u.entries.map((e) => e.seq)))
    expect(seqs).toEqual(Array.from({ length: 12_001 }, (_, i) => i))
    sessions[0]?.opts.onEntries?.([entry(12_001)], { lines: 12_002, errors: 0, shown: 12_002 }, [])
    vi.advanceTimersByTime(100)
    expect(sent).toHaveLength(4)
    expect(sent.at(-1)).toMatchObject({ kind: 'append', entries: [{ seq: 12_001 }] })
  })

  test('an invalid filter returns INVALID_LOG_FILTER', async () => {
    const { controller } = setup()
    await controller.open(STICK)
    await settle()
    expect(await controller.setFilter({ level: 'loud' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_LOG_FILTER' }
    })
  })

  test('clear pushes an empty reset', async () => {
    const { controller, sent } = setup()
    await controller.open(STICK)
    await settle()
    controller.clear()
    expect(sent.at(-1)).toEqual({
      kind: 'reset',
      session: 1,
      entries: [],
      counts: { lines: 0, errors: 0, shown: 0 },
      apps: ['com.example.player']
    })
  })

  test('exportText formats the shown entries up to throughSeq', async () => {
    const { controller } = setup()
    await controller.open(STICK)
    await settle()
    const exported = controller.exportText(0)
    expect(exported?.lines).toBe(1)
    expect(exported?.text).toMatch(/ I com\.amazon\.keplerscript +27178 player tick 0\n$/)
  })

  test('stop awaits the session’s end', async () => {
    const { controller, sessions } = setup()
    await controller.open(STICK)
    await settle()
    await controller.stop()
    expect(sessions[0]?.ended()).toEqual({ reason: 'stopped' })
    expect(controller.running()).toBe(false)
  })

  test('the renderer’s ring size is core’s buffer size', () => {
    expect(LOG_RING_SIZE).toBe(LOG_BUFFER_SIZE)
  })
})
