import { describe, expect, test } from 'vitest'
import type { LogsUpdate } from '../../../../src/preload/api'
import {
  applyUpdate,
  emptyStore,
  LOG_RING_SIZE,
  markSeen,
  newLines,
  pause,
  resume,
  setFollow,
  visibleCount
} from '../../../../src/renderer/src/screens/logs/logStore'
import { entries, logEntry } from './sample'

const counts = (lines: number) => ({ lines, errors: 0, shown: lines })
const reset = (session: number, n: number, from = 0): LogsUpdate => ({
  kind: 'reset',
  session,
  entries: entries(n, from),
  counts: counts(n),
  apps: []
})
const append = (session: number, n: number, from: number, lines = from + n): LogsUpdate => ({
  kind: 'append',
  session,
  entries: entries(n, from),
  counts: counts(lines),
  apps: ['com.example.player']
})

describe('logStore', () => {
  test('reset replaces the entries, append adds to them', () => {
    let store = applyUpdate(emptyStore(), reset(1, 3))
    store = applyUpdate(store, append(1, 2, 3))
    expect(store.entries.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4])
    expect(store.counts).toEqual(counts(5))
    expect(store.apps).toEqual(['com.example.player'])
    store = applyUpdate(store, reset(1, 1, 9))
    expect(store.entries.map((e) => e.seq)).toEqual([9])
  })

  test('an append with no entries still updates the counts', () => {
    let store = applyUpdate(emptyStore(), reset(1, 2))
    store = applyUpdate(store, append(1, 0, 2, 40))
    expect(store.entries).toHaveLength(2)
    expect(store.counts.lines).toBe(40)
  })

  test('keeps at most the ring size, dropping the oldest', () => {
    let store = applyUpdate(emptyStore(), reset(1, LOG_RING_SIZE))
    store = applyUpdate(store, append(1, 5, LOG_RING_SIZE))
    expect(store.entries).toHaveLength(LOG_RING_SIZE)
    expect(store.entries[0]?.seq).toBe(5)
  })

  test('updates of an older session are ignored; a newer one starts empty', () => {
    let store = applyUpdate(emptyStore(), reset(2, 3))
    store = applyUpdate(store, append(1, 5, 0))
    expect(store.entries).toHaveLength(3)
    store = applyUpdate(store, { kind: 'state', session: 3, state: { status: 'idle' } })
    expect(store).toMatchObject({ session: 3, entries: [], state: { status: 'idle' } })
  })

  test('pause freezes the visible count and counts new lines', () => {
    let store = applyUpdate(emptyStore(), reset(1, 10))
    store = pause(store)
    store = applyUpdate(store, append(1, 4, 10))
    expect(visibleCount(store)).toBe(10)
    expect(newLines(store)).toBe(4)
    store = resume(store)
    expect(visibleCount(store)).toBe(14)
    expect(newLines(store)).toBe(0)
  })

  test('pause survives a re-filter (a reset with fewer entries)', () => {
    let store = pause(applyUpdate(emptyStore(), reset(1, 10)))
    store = applyUpdate(store, {
      kind: 'reset',
      session: 1,
      entries: [logEntry(3), logEntry(15)],
      counts: counts(2),
      apps: []
    })
    expect(visibleCount(store)).toBe(1)
    expect(newLines(store)).toBe(1)
  })

  test('with Follow off, lines below what was seen are new until the bottom is reached', () => {
    let store = setFollow(applyUpdate(emptyStore(), reset(1, 5)), false)
    store = applyUpdate(store, append(1, 3, 5))
    expect(newLines(store)).toBe(3)
    store = markSeen(store)
    expect(newLines(store)).toBe(0)
    store = applyUpdate(store, append(1, 2, 8))
    store = setFollow(store, true)
    expect(newLines(store)).toBe(0)
  })
})
