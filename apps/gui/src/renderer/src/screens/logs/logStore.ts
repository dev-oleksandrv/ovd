import type { LogCounts, LogEntry } from '@ovd/core'
import type { LogsState, LogsUpdate } from '../../../../preload/api'

// The renderer keeps as many entries as core's ring (`LOG_BUFFER_SIZE`); the renderer can't
// import core runtime code, so the number is repeated here and a main test checks they match.
export const LOG_RING_SIZE = 100_000

export interface LogStore {
  // The session the entries belong to; updates of an older one are ignored.
  session: number
  state: LogsState
  entries: LogEntry[]
  counts: LogCounts
  apps: string[]
  // Paused: the list stops at this seq while main keeps sending.
  pausedThrough: number | null
  // Follow off: the last seq the user saw at the bottom; null while following.
  seenThrough: number | null
}

const NO_COUNTS: LogCounts = { lines: 0, errors: 0, shown: 0 }

export function emptyStore(): LogStore {
  return {
    session: 0,
    state: { status: 'idle' },
    entries: [],
    counts: NO_COUNTS,
    apps: [],
    pausedThrough: null,
    seenThrough: null
  }
}

export function applyUpdate(store: LogStore, update: LogsUpdate): LogStore {
  if (update.session < store.session) return store
  // A newer session starts from nothing (its first message may be a state or a reset).
  const base: LogStore =
    update.session > store.session
      ? { ...emptyStore(), session: update.session, state: store.state }
      : store
  if (update.kind === 'state') return { ...base, state: update.state }
  if (update.kind === 'reset') {
    return { ...base, entries: capped(update.entries), counts: update.counts, apps: update.apps }
  }
  const entries =
    update.entries.length === 0 ? base.entries : capped(base.entries.concat(update.entries))
  return { ...base, entries, counts: update.counts, apps: update.apps }
}

function capped(entries: LogEntry[]): LogEntry[] {
  return entries.length > LOG_RING_SIZE ? entries.slice(entries.length - LOG_RING_SIZE) : entries
}

export function pause(store: LogStore): LogStore {
  return { ...store, pausedThrough: store.entries.at(-1)?.seq ?? -1 }
}

export function resume(store: LogStore): LogStore {
  return { ...store, pausedThrough: null }
}

// Follow off: what the user has seen so far; on: back to following.
export function setFollow(store: LogStore, follow: boolean): LogStore {
  if (follow) return { ...store, seenThrough: null }
  return { ...store, seenThrough: store.entries.at(-1)?.seq ?? -1 }
}

// The user reached the bottom with Follow off: every line so far counts as seen.
export function markSeen(store: LogStore): LogStore {
  if (store.seenThrough === null) return store
  const last = store.entries.at(-1)?.seq ?? -1
  return last === store.seenThrough ? store : { ...store, seenThrough: last }
}

// How many entries have a seq up to `seq` (entries are in seq order): a binary search.
export function countThrough(entries: LogEntry[], seq: number): number {
  let lo = 0
  let hi = entries.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    const at = entries[mid]
    if (at !== undefined && at.seq <= seq) lo = mid + 1
    else hi = mid
  }
  return lo
}

// The entries the list shows: all of them, or those up to the pause.
export function visibleCount(store: LogStore): number {
  return store.pausedThrough === null
    ? store.entries.length
    : countThrough(store.entries, store.pausedThrough)
}

// Lines the user hasn't seen: after the pause, or below the bottom with Follow off.
export function newLines(store: LogStore): number {
  if (store.pausedThrough !== null) return store.entries.length - visibleCount(store)
  if (store.seenThrough !== null) {
    return store.entries.length - countThrough(store.entries, store.seenThrough)
  }
  return 0
}
