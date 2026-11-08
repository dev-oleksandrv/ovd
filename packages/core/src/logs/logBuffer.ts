import { isAppIdentity } from './logFilter.js'
import { LOG_BUFFER_SIZE, type LogCounts, type LogEntry } from './types.js'

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

// A ring of the latest entries; the oldest go first once it is full. `capacity: 0` keeps
// only the counts and the apps seen (the CLI prints and forgets).
export function createLogBuffer(
  capacity = LOG_BUFFER_SIZE,
  initial: Matches = () => true
): LogBuffer {
  let matches = initial
  let ring: (LogEntry | undefined)[] = new Array<LogEntry | undefined>(capacity)
  let start = 0
  let size = 0
  let lines = 0
  let errors = 0
  let shown = 0
  const seen = new Set<string>()

  function* inOrder(): Generator<LogEntry> {
    for (let i = 0; i < size; i++) {
      const entry = ring[(start + i) % capacity]
      if (entry) yield entry
    }
  }

  return {
    add(entries) {
      for (const entry of entries) {
        lines++
        if (entry.level === 'E') errors++
        if (isAppIdentity(entry.process) && entry.process !== null) seen.add(entry.process)
        if (capacity === 0) continue
        const match = matches(entry)
        if (size < capacity) {
          ring[(start + size) % capacity] = entry
          size++
        } else {
          const dropped = ring[start]
          if (dropped && matches(dropped)) shown--
          ring[start] = entry
          start = (start + 1) % capacity
        }
        if (match) shown++
      }
    },
    clear() {
      ring = new Array<LogEntry | undefined>(capacity)
      start = 0
      size = 0
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
      return { lines, errors, shown }
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
