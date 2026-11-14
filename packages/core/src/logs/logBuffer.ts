import { isAppIdentity, type LogEvaluator } from './logFilter.js'
import { LOG_BUFFER_BYTES, LOG_BUFFER_SIZE, type LogCounts, type LogEntry } from './types.js'

type Matches = (entry: LogEntry) => boolean

// What the buffer filters with: a stateless predicate, or a compiled filter, which makes a
// fresh evaluator per pass because rate limits depend on the entries before.
export type BufferFilter = Matches | { evaluator(): LogEvaluator }

const NO_LINES: readonly LogEntry[] = []

function evaluatorOf(filter: BufferFilter): LogEvaluator {
  if (typeof filter !== 'function') return filter.evaluator()
  return { next: (entry) => ({ shown: filter(entry), before: NO_LINES }), flush: () => [] }
}

export interface LogBuffer {
  // Returns what to show for these entries, in order: the matching ones, each preceded by the
  // derived lines (rate-limited) its arrival closed. The buffer judges each entry once, when it
  // arrives, because the evaluator is stateful.
  add(entries: LogEntry[]): LogEntry[]
  clear(): void
  // Re-filters the buffer from a fresh evaluator, over the whole buffer in order, so the result
  // is the one streaming gives (F30). `shown` is recounted once, then kept up to date on every
  // add.
  setFilter(filter: BufferFilter): void
  // The same for a plain predicate.
  setMatches(matches: Matches): void
  // End of input (the session ended): the derived lines of the seconds still open. They follow
  // the last entry in `filtered()` until the next add.
  flush(): LogEntry[]
  counts(): LogCounts
  // The entries that match, in order, up to `throughSeq` when given, with the derived lines
  // (rate-limited) before the entry that closed them. Those lines aren't stored: they are
  // recomputed by every `setFilter`.
  filtered(throughSeq?: number): LogEntry[]
  // App identities seen since the start, kept across Clear (the stream still runs).
  apps(): string[]
}

// What an entry is counted as against the byte budget: a fixed overhead for the object, plus
// two bytes per character of its strings. An estimate, but deterministic, so an eviction
// subtracts exactly what the add counted.
export const ENTRY_OVERHEAD_BYTES = 128

export function entryBytes(entry: LogEntry): number {
  const chars =
    entry.time.length +
    (entry.deviceTime?.length ?? 0) +
    (entry.priority?.length ?? 0) +
    (entry.facility?.length ?? 0) +
    (entry.process?.length ?? 0) +
    entry.tag.length +
    entry.message.length
  return ENTRY_OVERHEAD_BYTES + 2 * chars
}

// A ring of the latest entries; the oldest go first once it holds `capacity` entries or more
// than `budgetBytes` (by `entryBytes`). An entry larger than the whole budget is kept alone,
// until the next one evicts it. `capacity: 0` keeps only the counts and the apps seen (the CLI
// prints and forgets).
export function createLogBuffer(
  capacity = LOG_BUFFER_SIZE,
  initial: BufferFilter = () => true,
  budgetBytes = LOG_BUFFER_BYTES
): LogBuffer {
  let currentFilter = initial
  let evaluator = evaluatorOf(initial)
  let ring: (LogEntry | undefined)[] = new Array<LogEntry | undefined>(capacity)
  // Per slot: whether the entry is shown, and the derived lines before it (rare).
  let shownAt = new Uint8Array(capacity)
  const beforeAt = new Map<number, readonly LogEntry[]>()
  let tail: LogEntry[] = []
  let flushed = false
  let start = 0
  let size = 0
  let lines = 0
  let errors = 0
  let shown = 0
  let bytes = 0
  const seen = new Set<string>()

  const weight = (slot: number): number => (shownAt[slot] ?? 0) + (beforeAt.get(slot)?.length ?? 0)

  const record = (slot: number, verdict: ReturnType<LogEvaluator['next']>): void => {
    shownAt[slot] = verdict.shown ? 1 : 0
    if (verdict.before.length > 0) beforeAt.set(slot, verdict.before)
    else beforeAt.delete(slot)
    shown += weight(slot)
  }

  function dropOldest(): void {
    const dropped = ring[start]
    if (dropped) {
      bytes -= entryBytes(dropped)
      shown -= weight(start)
    }
    beforeAt.delete(start)
    shownAt[start] = 0
    ring[start] = undefined
    start = (start + 1) % capacity
    size--
  }

  function* inOrder(): Generator<[LogEntry, number]> {
    for (let i = 0; i < size; i++) {
      const slot = (start + i) % capacity
      const entry = ring[slot]
      if (entry) yield [entry, slot]
    }
  }

  const setFilter = (filter: BufferFilter): void => {
    evaluator = evaluatorOf(filter)
    shown = 0
    tail = []
    for (const [entry, slot] of inOrder()) {
      shownAt[slot] = 0
      beforeAt.delete(slot)
      record(slot, evaluator.next(entry))
    }
    if (flushed) {
      tail = evaluator.flush()
      shown += tail.length
    }
  }

  return {
    add(entries) {
      // New entries make the lines of the last flush stale: the evaluator goes on from there.
      if (tail.length > 0) {
        shown -= tail.length
        tail = []
      }
      flushed = false
      const out: LogEntry[] = []
      for (const entry of entries) {
        // An OVD line is kept and shown, but it isn't a device line or an error.
        if (entry.ovd === undefined) {
          lines++
          if (entry.level === 'E') errors++
        }
        if (isAppIdentity(entry.process) && entry.process !== null) seen.add(entry.process)
        const verdict = evaluator.next(entry)
        for (const line of verdict.before) out.push(line)
        if (verdict.shown) out.push(entry)
        if (capacity === 0) continue
        if (size === capacity) dropOldest()
        const slot = (start + size) % capacity
        ring[slot] = entry
        size++
        bytes += entryBytes(entry)
        record(slot, verdict)
        while (bytes > budgetBytes && size > 1) dropOldest()
      }
      return out
    },
    clear() {
      ring = new Array<LogEntry | undefined>(capacity)
      shownAt = new Uint8Array(capacity)
      beforeAt.clear()
      tail = []
      flushed = false
      evaluator = evaluatorOf(currentFilter)
      start = 0
      size = 0
      bytes = 0
      lines = 0
      errors = 0
      shown = 0
    },
    setFilter(filter) {
      currentFilter = filter
      setFilter(filter)
    },
    setMatches(next) {
      currentFilter = next
      setFilter(next)
    },
    flush() {
      if (flushed) return []
      flushed = true
      tail = evaluator.flush()
      shown += tail.length
      return [...tail]
    },
    counts() {
      const oldest = size > 0 ? ring[start]?.time : undefined
      return { lines, errors, shown, ...(oldest === undefined ? {} : { oldest }) }
    },
    filtered(throughSeq) {
      const out: LogEntry[] = []
      for (const [entry, slot] of inOrder()) {
        if (throughSeq !== undefined && entry.seq > throughSeq) return out
        for (const line of beforeAt.get(slot) ?? NO_LINES) out.push(line)
        if (shownAt[slot]) out.push(entry)
      }
      for (const line of tail) out.push(line)
      return out
    },
    apps() {
      return [...seen].sort()
    }
  }
}
