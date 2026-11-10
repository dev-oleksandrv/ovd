import { createHash } from 'node:crypto'
import type { LogEntry } from './types.js'

// How far back, and how many entries, a restarted stream's backlog is compared against. The
// Virtual Device prints the stopped stream's last 573 lines (about 12 s) again (ARCHITECTURE §8).
export const RESTART_OVERLAP_MS = 120_000
export const RESTART_OVERLAP_KEYS = 50_000

export interface OverlapSnapshot {
  // True for an entry of the new stream's backlog that was already delivered.
  drops(entry: LogEntry): boolean
}

export interface OverlapWindow {
  // Records a delivered device entry (one with a device time).
  record(entry: LogEntry): void
  // What has been delivered so far, for the next stream.
  snapshot(): OverlapSnapshot
}

// The delivered device entries of the last RESTART_OVERLAP_MS (at most RESTART_OVERLAP_KEYS),
// so a new stream's backlog isn't shown twice. Keys are sha1 hashes: a 256 KB message costs a
// few bytes.
export function createOverlapWindow(): OverlapWindow {
  let fifo: { key: string; at: number }[] = []
  let head = 0
  const counts = new Map<string, number>()
  let newest = Number.NEGATIVE_INFINITY

  const evictFront = () => {
    const front = fifo[head]
    if (front === undefined) return
    head++
    const left = (counts.get(front.key) ?? 1) - 1
    if (left <= 0) counts.delete(front.key)
    else counts.set(front.key, left)
    // Compact once the evicted part is the larger half.
    if (head > 1024 && head * 2 > fifo.length) {
      fifo = fifo.slice(head)
      head = 0
    }
  }

  return {
    record(entry) {
      if (entry.deviceTime === null) return
      const at = Date.parse(entry.time)
      const key = keyOf(entry)
      fifo.push({ key, at })
      counts.set(key, (counts.get(key) ?? 0) + 1)
      if (at > newest) newest = at
      while (fifo.length - head > RESTART_OVERLAP_KEYS) evictFront()
      while (head < fifo.length && (fifo[head]?.at ?? newest) < newest - RESTART_OVERLAP_MS) {
        evictFront()
      }
    },
    snapshot() {
      let keys: Set<string> | undefined = new Set(counts.keys())
      const last = newest
      return {
        drops(entry) {
          if (entry.deviceTime === null || keys === undefined) return false
          if (Date.parse(entry.time) > last) {
            // Past the last delivered entry: the backlog is over, for good.
            keys = undefined
            return false
          }
          return keys.has(keyOf(entry))
        }
      }
    }
  }
}

function keyOf(entry: LogEntry): string {
  return createHash('sha1')
    .update(
      [
        entry.deviceTime ?? '',
        entry.process ?? '',
        String(entry.pid ?? ''),
        String(entry.tid ?? ''),
        entry.tag,
        entry.message
      ].join('\u0000')
    )
    .digest('base64')
}
