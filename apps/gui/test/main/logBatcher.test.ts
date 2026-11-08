// @vitest-environment node
import type { LogCounts, LogEntry } from '@ovd/core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createLogBatcher } from '../../src/main/logBatcher'
import type { LogsUpdate } from '../../src/preload/api'

const entry = (seq: number): LogEntry => ({
  seq,
  time: '2026-11-08T07:27:00.000Z',
  deviceTime: 'Nov 08 07:27:00.000000',
  level: 'I',
  priority: 'info',
  facility: 'user',
  process: 'com.example.player',
  pid: 27178,
  tid: 2842092448,
  tag: 'com.amazon.keplerscript',
  message: `player flood ${seq}`,
  parsed: true
})
const counts = (lines: number): LogCounts => ({ lines, errors: 0, shown: lines })

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

function setup() {
  const sent: LogsUpdate[] = []
  const batcher = createLogBatcher({ send: (u) => sent.push(u) })
  const appends = () => sent.filter((u) => u.kind === 'append')
  return { batcher, sent, appends }
}

describe('createLogBatcher', () => {
  test('5,000 entries a second for 10 s cross in at most 101 messages, each once and in order', () => {
    const { batcher, appends } = setup()
    let seq = 0
    for (let ms = 0; ms < 10_000; ms++) {
      batcher.append(
        1,
        [entry(seq++), entry(seq++), entry(seq++), entry(seq++), entry(seq++)],
        counts(seq),
        []
      )
      vi.advanceTimersByTime(1)
    }
    vi.advanceTimersByTime(100)
    expect(appends().length).toBeLessThanOrEqual(101)
    const seqs = appends().flatMap((u) => (u.kind === 'append' ? u.entries.map((e) => e.seq) : []))
    expect(seqs).toEqual(Array.from({ length: 50_000 }, (_, i) => i))
  })

  test('nothing is sent before 100 ms', () => {
    const { batcher, sent } = setup()
    batcher.append(1, [entry(0)], counts(1), ['com.example.player'])
    vi.advanceTimersByTime(99)
    expect(sent).toEqual([])
    vi.advanceTimersByTime(1)
    expect(sent).toEqual([
      {
        kind: 'append',
        session: 1,
        entries: [entry(0)],
        counts: counts(1),
        apps: ['com.example.player']
      }
    ])
  })

  test('batches with no matching entries still send the latest counts, once per interval', () => {
    const { batcher, appends } = setup()
    for (let i = 1; i <= 10; i++) {
      batcher.append(1, [], counts(i), [])
      vi.advanceTimersByTime(20)
    }
    vi.advanceTimersByTime(100)
    expect(appends()).toHaveLength(2)
    expect(appends().every((u) => u.kind === 'append' && u.entries.length === 0)).toBe(true)
    expect(appends().at(-1)).toMatchObject({ counts: counts(10) })
  })

  test('a reset cancels pending appends and is sent at once', () => {
    const { batcher, sent } = setup()
    batcher.append(1, [entry(0)], counts(1), [])
    batcher.reset(1, [], counts(0), [])
    expect(sent).toEqual([{ kind: 'reset', session: 1, entries: [], counts: counts(0), apps: [] }])
    vi.advanceTimersByTime(200)
    expect(sent).toHaveLength(1)
  })

  test('a reset of 12,001 entries goes out as a reset and two appends, in order', () => {
    const { batcher, sent } = setup()
    const entries = Array.from({ length: 12_001 }, (_, i) => entry(i))

    batcher.reset(1, entries, counts(12_001), ['com.example.player'])

    expect(sent.map((u) => u.kind)).toEqual(['reset', 'append', 'append'])
    expect(sent.map((u) => (u.kind === 'state' ? 0 : u.entries.length))).toEqual([
      5_000, 5_000, 2_001
    ])
    const seqs = sent.flatMap((u) => (u.kind === 'state' ? [] : u.entries.map((e) => e.seq)))
    expect(seqs).toEqual(Array.from({ length: 12_001 }, (_, i) => i))
    expect(sent.every((u) => u.kind !== 'state' && u.session === 1)).toBe(true)
    expect(
      sent.every(
        (u) =>
          u.kind !== 'state' &&
          u.counts.lines === 12_001 &&
          u.apps.length === 1 &&
          u.apps[0] === 'com.example.player'
      )
    ).toBe(true)
  })

  test('an append made right after a reset comes after the reset’s messages', () => {
    const { batcher, sent } = setup()
    batcher.reset(
      1,
      Array.from({ length: 6_000 }, (_, i) => entry(i)),
      counts(6_000),
      []
    )
    batcher.append(1, [entry(6_000)], counts(6_001), [])
    expect(sent).toHaveLength(2)

    vi.advanceTimersByTime(100)

    expect(sent.map((u) => u.kind)).toEqual(['reset', 'append', 'append'])
    expect(sent[2]).toMatchObject({ entries: [entry(6_000)], counts: counts(6_001) })
  })

  test('a state is sent at once', () => {
    const { batcher, sent } = setup()
    batcher.state(2, { status: 'idle' })
    expect(sent).toEqual([{ kind: 'state', session: 2, state: { status: 'idle' } }])
  })

  test('100,000 queued entries are one message', () => {
    const { batcher, appends } = setup()
    batcher.append(
      1,
      Array.from({ length: 100_000 }, (_, i) => entry(i)),
      counts(100_000),
      []
    )
    vi.advanceTimersByTime(100)
    expect(appends()).toHaveLength(1)
    expect(appends()[0]).toMatchObject({ entries: { length: 100_000 } })
  })

  test('pending entries beyond 100,000 drop the oldest first', () => {
    const { batcher, appends } = setup()
    batcher.append(
      1,
      Array.from({ length: 100_000 }, (_, i) => entry(i)),
      counts(100_000),
      []
    )
    batcher.append(1, [entry(100_000)], counts(100_001), [])
    vi.advanceTimersByTime(100)
    const [first] = appends()
    expect(first?.kind === 'append' && first.entries[0]?.seq).toBe(1)
    expect(first?.kind === 'append' && first.entries.length).toBe(100_000)
  })
})
