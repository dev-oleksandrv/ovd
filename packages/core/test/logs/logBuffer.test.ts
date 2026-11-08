import { expect, test } from 'vitest'
import { createLogBuffer } from '../../src/logs/logBuffer.js'
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
  expect(buffer.counts()).toEqual({ lines: 5, errors: 1, shown: 3 })
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
  expect(buffer.counts()).toEqual({ lines: 100_000, errors: 10_000, shown: 10_000 })
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
