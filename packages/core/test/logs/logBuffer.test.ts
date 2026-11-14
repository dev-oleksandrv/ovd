import { describe, expect, test } from 'vitest'
import { createLogBuffer, ENTRY_OVERHEAD_BYTES, entryBytes } from '../../src/logs/logBuffer.js'
import { compileLogFilter } from '../../src/logs/logFilter.js'
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

describe('with a compiled filter', () => {
  const NOW = new Date('2026-11-08T12:00:00Z')

  test('the verdict is stored when the entry arrives: eviction subtracts what the add counted', () => {
    // A stateful evaluator: only the first two lines of each second are shown.
    const calls: number[] = []
    const filter = {
      evaluator() {
        let shownNow = 0
        return {
          next(e: LogEntry) {
            calls.push(e.seq)
            shownNow++
            return { shown: shownNow <= 2, before: [] }
          },
          flush: () => []
        }
      }
    }
    const buffer = createLogBuffer(3, filter)
    buffer.add(range(0, 5))
    // Five arrivals, five judgements: dropping an entry doesn't judge it again.
    expect(calls).toEqual([0, 1, 2, 3, 4])
    // Entries 2..4 are held; only 0 and 1 were shown, and both are gone.
    expect(buffer.counts().shown).toBe(0)
    expect(buffer.filtered()).toEqual([])
  })

  test('add returns what to show, derived lines before the entry that closed them', () => {
    const buffer = createLogBuffer(
      10,
      compileLogFilter({ processRules: [{ identity: 'a', rate: 1 }] }, NOW)
    )
    const at = (seq: number, second: number, process: string) =>
      entry(seq, { process, time: `2026-11-08T07:27:0${second}.000Z`, message: `m${seq}` })
    const out = buffer.add([at(0, 0, 'a'), at(1, 0, 'a'), at(2, 0, 'b'), at(3, 1, 'b')])
    expect(out.map((e) => e.message)).toEqual(['m0', 'm2', 'a: 1 lines hidden by rate limit', 'm3'])
    expect(buffer.filtered().map((e) => e.message)).toEqual(out.map((e) => e.message))
    expect(buffer.counts().shown).toBe(4)
  })

  test('derived lines count as shown, are dropped with their entry and cut by throughSeq', () => {
    const buffer = createLogBuffer(
      3,
      compileLogFilter({ processRules: [{ identity: 'a', rate: 1 }] }, NOW)
    )
    const at = (seq: number, second: number) =>
      entry(seq, { process: 'a', time: `2026-11-08T07:27:0${second}.000Z`, message: `m${seq}` })
    buffer.add([at(0, 0), at(1, 0), at(2, 1), at(3, 1), at(4, 2)])
    // Held: m2, m3, m4. m3 is over the rate. The line before m2 closes second 0 (m1 hidden),
    // the one before m4 closes second 1 (m3 hidden); a derived line goes with the entry that
    // closed it, so it survives while that entry does.
    expect(buffer.filtered().map((e) => e.message)).toEqual([
      'a: 1 lines hidden by rate limit',
      'm2',
      'a: 1 lines hidden by rate limit',
      'm4'
    ])
    expect(buffer.counts().shown).toBe(4)
    // m4 and its derived line share seq 4: through seq 3 cuts both.
    expect(buffer.filtered(3).map((e) => e.message)).toEqual([
      'a: 1 lines hidden by rate limit',
      'm2'
    ])
  })

  test('flush gives the open seconds, keeps them after the last entry, and add retracts them', () => {
    const buffer = createLogBuffer(
      10,
      compileLogFilter({ processRules: [{ identity: 'a', rate: 1 }] }, NOW)
    )
    buffer.add([entry(0, { process: 'a' }), entry(1, { process: 'a' })])
    expect(buffer.flush().map((e) => e.message)).toEqual(['a: 1 lines hidden by rate limit'])
    expect(buffer.flush()).toEqual([])
    expect(buffer.filtered().map((e) => e.message)).toEqual([
      'm 0',
      'a: 1 lines hidden by rate limit'
    ])
    expect(buffer.counts().shown).toBe(2)
    buffer.add([entry(2, { process: 'b' })])
    expect(buffer.filtered().map((e) => e.message)).toEqual(['m 0', 'm 2'])
    expect(buffer.counts().shown).toBe(2)
  })

  test('clear starts the rate counters afresh', () => {
    const buffer = createLogBuffer(
      10,
      compileLogFilter({ processRules: [{ identity: 'a', rate: 1 }] }, NOW)
    )
    buffer.add([entry(0, { process: 'a' })])
    buffer.clear()
    expect(buffer.add([entry(1, { process: 'a' })]).map((e) => e.message)).toEqual(['m 1'])
  })

  test('a buffer that keeps nothing still judges: add returns the shown entries', () => {
    const buffer = createLogBuffer(
      0,
      compileLogFilter({ processRules: [{ identity: 'a', rate: 1 }] }, NOW)
    )
    const out = buffer.add([entry(0, { process: 'a' }), entry(1, { process: 'a' })])
    expect(out.map((e) => e.message)).toEqual(['m 0'])
    expect(buffer.counts().shown).toBe(0)
  })
})
