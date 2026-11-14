import { isAppIdentity } from './logFilter.js'
import { LOG_BUFFER_BYTES, LOG_BUFFER_SIZE, type LogCounts, type LogEntry } from './types.js'

type Matches = (entry: LogEntry) => boolean

export interface LogBuffer {
  add(entries: LogEntry[]): void
  clear(): void
  // Re-filters the buffer: `shown` is recounted once, then kept up to date on every add.
  setMatches(matches: Matches): void
  counts(): LogCounts
  // The entries that match, in order, up to `throughSeq` when given.
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
  initial: Matches = () => true,
  budgetBytes = LOG_BUFFER_BYTES
): LogBuffer {
  let matches = initial
  let ring: (LogEntry | undefined)[] = new Array<LogEntry | undefined>(capacity)
  let start = 0
  let size = 0
  let lines = 0
  let errors = 0
  let shown = 0
  let bytes = 0
  const seen = new Set<string>()

  function dropOldest(): void {
    const dropped = ring[start]
    if (dropped) {
      bytes -= entryBytes(dropped)
      if (matches(dropped)) shown--
    }
    ring[start] = undefined
    start = (start + 1) % capacity
    size--
  }

  function* inOrder(): Generator<LogEntry> {
    for (let i = 0; i < size; i++) {
      const entry = ring[(start + i) % capacity]
      if (entry) yield entry
    }
  }

  return {
    add(entries) {
      for (const entry of entries) {
        // An OVD line is kept and shown, but it isn't a device line or an error.
        if (entry.ovd === undefined) {
          lines++
          if (entry.level === 'E') errors++
        }
        if (isAppIdentity(entry.process) && entry.process !== null) seen.add(entry.process)
        if (capacity === 0) continue
        if (size === capacity) dropOldest()
        ring[(start + size) % capacity] = entry
        size++
        bytes += entryBytes(entry)
        if (matches(entry)) shown++
        while (bytes > budgetBytes && size > 1) dropOldest()
      }
    },
    clear() {
      ring = new Array<LogEntry | undefined>(capacity)
      start = 0
      size = 0
      bytes = 0
      lines = 0
      errors = 0
      shown = 0
    },
    setMatches(next) {
      matches = next
      shown = 0
      for (const entry of inOrder()) if (matches(entry)) shown++
    },
    counts() {
      const oldest = size > 0 ? ring[start]?.time : undefined
      return { lines, errors, shown, ...(oldest === undefined ? {} : { oldest }) }
    },
    filtered(throughSeq) {
      const out: LogEntry[] = []
      for (const entry of inOrder()) {
        if (throughSeq !== undefined && entry.seq > throughSeq) break
        if (matches(entry)) out.push(entry)
      }
      return out
    },
    apps() {
      return [...seen].sort()
    }
  }
}
