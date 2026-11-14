import { describe, expect, test } from 'vitest'
import { createLogBuffer, ENTRY_OVERHEAD_BYTES, entryBytes } from '../../src/logs/logBuffer.js'
import type { LogEntry } from '../../src/logs/types.js'

const entry = (seq: number, over: Partial<LogEntry> = {}): LogEntry => ({
  seq,
  time: '2026-11-08T07:27:00.000Z',
  deviceTime: 'Nov 08 07:27:00.000000',
  level: seq % 10 === 0 ? 'E' : 'I',
  priority: 'info',
  facility: 'local0',
  process: seq % 2 === 0 ? 'com.example.player' : 'lcm_service',
  pid: 1,
  tid: 1,
  tag: 't',
  message: `m ${seq}`,
  parsed: true,
  ...over
})
const range = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => entry(from + i))

test('keeps the latest entries once full, oldest dropped first', () => {
  const buffer = createLogBuffer(3)
  buffer.add(range(0, 5))
  expect(buffer.filtered().map((e) => e.seq)).toEqual([2, 3, 4])
  expect(buffer.counts()).toEqual({
    lines: 5,
    errors: 1,
    shown: 3,
    oldest: '2026-11-08T07:27:00.000Z'
  })
})

test('shown follows the filter, also while entries are dropped', () => {
  const buffer = createLogBuffer(4, (e) => e.process === 'com.example.player')
  buffer.add(range(0, 6))
  expect(buffer.counts().shown).toBe(2)
  buffer.setMatches(() => true)
  expect(buffer.counts().shown).toBe(4)
})

test('clear empties the buffer and the counts, but keeps the apps seen', () => {
  const buffer = createLogBuffer(10)
  buffer.add(range(0, 4))
  buffer.clear()
  expect(buffer.counts()).toEqual({ lines: 0, errors: 0, shown: 0 })
  expect(buffer.filtered()).toEqual([])
  expect(buffer.apps()).toEqual(['com.example.player'])
})

test('re-filtering 100,000 entries gives the right count', () => {
  const buffer = createLogBuffer()
  buffer.add(range(0, 100_000))
  buffer.setMatches((e) => e.level === 'E')
  expect(buffer.counts()).toEqual({
    lines: 100_000,
    errors: 10_000,
    shown: 10_000,
    oldest: '2026-11-08T07:27:00.000Z'
  })
  expect(buffer.filtered()).toHaveLength(10_000)
})

test('filtered stops at throughSeq', () => {
  const buffer = createLogBuffer(10)
  buffer.add(range(0, 8))
  expect(buffer.filtered(4).map((e) => e.seq)).toEqual([0, 1, 2, 3, 4])
})

test('capacity 0 keeps counts and apps, no entries', () => {
  const buffer = createLogBuffer(0)
  buffer.add([...range(0, 3), entry(3, { process: 'com.example.hellovega' })])
  expect(buffer.filtered()).toEqual([])
  expect(buffer.counts()).toEqual({ lines: 4, errors: 1, shown: 0 })
  expect(buffer.apps()).toEqual(['com.example.hellovega', 'com.example.player'])
})

describe('the byte budget', () => {
  // Every entry built by `entry` has the same size.
  const each = entryBytes(entry(10))
  const budget = 3 * each

  test('evicts the oldest entries, in order, once the budget is used', () => {
    const buffer = createLogBuffer(100, () => true, budget)
    buffer.add(range(10, 15))
    expect(buffer.filtered().map((e) => e.seq)).toEqual([12, 13, 14])
    expect(buffer.counts()).toMatchObject({ lines: 5, shown: 3 })
  })

  test('shown stays right after evictions under a filter', () => {
    const buffer = createLogBuffer(100, (e) => e.process === 'com.example.player', budget)
    buffer.add(range(10, 16))
    // 13, 14, 15 are kept; only 14 is the player's.
    expect(buffer.filtered().map((e) => e.seq)).toEqual([14])
    expect(buffer.counts().shown).toBe(1)
    buffer.setMatches(() => true)
    expect(buffer.counts().shown).toBe(3)
  })

  test('an entry bigger than the budget is kept alone, then evicted by the next one', () => {
    const buffer = createLogBuffer(100, () => true, budget)
    buffer.add(range(10, 12))
    buffer.add([entry(12, { message: 'x'.repeat(budget) })])
    expect(buffer.filtered().map((e) => e.seq)).toEqual([12])
    expect(buffer.counts().shown).toBe(1)
    buffer.add([entry(13)])
    expect(buffer.filtered().map((e) => e.seq)).toEqual([13])
    expect(buffer.counts().shown).toBe(1)
  })

  test('clear resets the bytes counted', () => {
    const buffer = createLogBuffer(100, () => true, budget)
    buffer.add(range(10, 13))
    buffer.clear()
    buffer.add(range(13, 16))
    expect(buffer.filtered().map((e) => e.seq)).toEqual([13, 14, 15])
  })

  test('entryBytes is deterministic and grows with the message', () => {
    expect(entryBytes(entry(10))).toBe(entryBytes(entry(10)))
    expect(entryBytes(entry(10, { message: 'm 10 longer' }))).toBe(
      entryBytes(entry(10)) + 2 * ' longer'.length
    )
    expect(entryBytes(entry(10))).toBeGreaterThan(ENTRY_OVERHEAD_BYTES)
  })

  test('capacity 0 still keeps nothing', () => {
    const buffer = createLogBuffer(0, () => true, budget)
    buffer.add(range(10, 15))
    expect(buffer.filtered()).toEqual([])
    expect(buffer.counts()).toEqual({ lines: 5, errors: 1, shown: 0 })
  })
})

test('an OVD entry is kept and shown but counts in neither lines nor errors, and adds no app', () => {
  const buffer = createLogBuffer(10)
  buffer.add([entry(1)])
  const ovd = entry(2, {
    level: 'E',
    deviceTime: null,
    priority: null,
    facility: null,
    process: null,
    pid: null,
    tid: null,
    tag: 'OVD',
    message: 'Log session restarted',
    ovd: { kind: 'restarted', reason: 'install' }
  })
  buffer.add([ovd])
  expect(buffer.filtered().map((e) => e.seq)).toEqual([1, 2])
  expect(buffer.counts()).toEqual({
    lines: 1,
    errors: 0,
    shown: 2,
    oldest: '2026-11-08T07:27:00.000Z'
  })
  expect(buffer.apps()).toEqual([])
})

describe('the oldest retained time', () => {
  const at = (seq: number) => new Date(Date.UTC(2026, 10, 8, 7, 0, seq)).toISOString()
  const timed = (from: number, to: number) =>
    Array.from({ length: to - from }, (_, i) => entry(from + i, { time: at(from + i) }))

  test('is the first entry while nothing was dropped, and absent while empty', () => {
    const buffer = createLogBuffer(10)
    expect(buffer.counts().oldest).toBeUndefined()
    buffer.add(timed(3, 6))
    expect(buffer.counts().oldest).toBe(at(3))
  })

  test('moves forward when a full buffer drops its oldest entries', () => {
    const buffer = createLogBuffer(3)
    buffer.add(timed(0, 5))
    expect(buffer.counts().oldest).toBe(at(2))
  })

  test('moves forward when the byte budget drops entries', () => {
    const buffer = createLogBuffer(100, () => true, entryBytes(entry(10, { time: at(10) })) * 2)
    buffer.add(timed(10, 14))
    expect(buffer.counts().oldest).toBe(at(12))
  })

  test('is absent after Clear, then the first line after it', () => {
    const buffer = createLogBuffer(10)
    buffer.add(timed(0, 4))
    buffer.clear()
    expect(buffer.counts().oldest).toBeUndefined()
    buffer.add(timed(7, 9))
    expect(buffer.counts().oldest).toBe(at(7))
  })

  test('does not depend on the filter', () => {
    const buffer = createLogBuffer(10, (e) => e.seq > 5)
    buffer.add(timed(0, 8))
    expect(buffer.counts().oldest).toBe(at(0))
  })
})
