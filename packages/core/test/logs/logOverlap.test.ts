import { expect, test } from 'vitest'
import {
  createOverlapWindow,
  RESTART_OVERLAP_KEYS,
  RESTART_OVERLAP_MS
} from '../../src/logs/logOverlap.js'
import type { LogEntry } from '../../src/logs/types.js'

const BASE = Date.parse('2026-11-09T21:42:00.000Z')

// A device entry `ms` after BASE, its message `m <n>`.
const entry = (ms: number, n = ms, over: Partial<LogEntry> = {}): LogEntry => ({
  seq: n,
  time: new Date(BASE + ms).toISOString(),
  deviceTime: `Nov 09 ${new Date(BASE + ms).toISOString().slice(11, 23)}000`,
  level: 'I',
  priority: 'info',
  facility: 'local0',
  process: 'lcm_service',
  pid: 1059,
  tid: 1352,
  tag: 'resmgr',
  message: `m ${n}`,
  parsed: true,
  ...over
})

test('drops the repeated entries and stops at the first newer one', () => {
  const window = createOverlapWindow()
  const delivered = [entry(0), entry(10), entry(20)]
  for (const e of delivered) window.record(e)
  const snapshot = window.snapshot()
  expect(delivered.map((e) => snapshot.drops({ ...e, seq: 99 }))).toEqual([true, true, true])
  // Same time as the newest, but a different message: new, kept.
  expect(snapshot.drops(entry(20, 21))).toBe(false)
  expect(snapshot.drops(entry(30))).toBe(false)
  // After the first newer entry nothing is dropped, even a repeat.
  expect(snapshot.drops(entry(10))).toBe(false)
})

test('an entry without a device time is never dropped', () => {
  const window = createOverlapWindow()
  const plain = entry(0, 0, { deviceTime: null, parsed: false })
  window.record(entry(0))
  window.record(plain)
  const snapshot = window.snapshot()
  expect(snapshot.drops(plain)).toBe(false)
  expect(snapshot.drops(entry(0))).toBe(true)
})

test('keeps at most 50 000 keys', () => {
  const window = createOverlapWindow()
  for (let n = 0; n < RESTART_OVERLAP_KEYS + 10; n++) window.record(entry(0, n))
  const snapshot = window.snapshot()
  expect(snapshot.drops(entry(0, 9))).toBe(false)
  expect(snapshot.drops(entry(0, 10))).toBe(true)
  expect(snapshot.drops(entry(0, RESTART_OVERLAP_KEYS + 9))).toBe(true)
})

test('forgets keys older than 120 s before the newest', () => {
  const window = createOverlapWindow()
  window.record(entry(0))
  window.record(entry(1_000))
  window.record(entry(1_000 + RESTART_OVERLAP_MS))
  const snapshot = window.snapshot()
  expect(snapshot.drops(entry(0))).toBe(false)
  expect(snapshot.drops(entry(1_000))).toBe(true)
  expect(snapshot.drops(entry(1_000 + RESTART_OVERLAP_MS))).toBe(true)
})
