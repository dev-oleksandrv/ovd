import { LOG_BUFFER_SIZE, type LogCounts, type LogEntry } from '@ovd/core'
import type { LogsState, LogsUpdate } from '../preload/api'

// At most one `append` message per this many ms, however fast the device logs (spec AC 16).
export const LOG_BATCH_MS = 100

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

export interface LogBatcher {
  // Queues the entries (possibly none) and keeps the latest counts and apps; one flush per
  // interval sends them, so a batch with no matching entries still delivers its counts.
  append(session: number, entries: LogEntry[], counts: LogCounts, apps: string[]): void
  // Drops anything pending and sends at once.
  reset(session: number, entries: LogEntry[], counts: LogCounts, apps: string[]): void
  state(session: number, state: LogsState): void
  // Drops anything pending (the session was replaced).
  cancel(): void
}

export function createLogBatcher(opts: {
  send: (update: LogsUpdate) => void
  intervalMs?: number
  timers?: Timers
}): LogBatcher {
  const intervalMs = opts.intervalMs ?? LOG_BATCH_MS
  const timers = opts.timers ?? realTimers
  let pending: { session: number; entries: LogEntry[]; counts: LogCounts; apps: string[] } | null =
    null
  let timer: unknown

  const cancel = () => {
    if (timer !== undefined) timers.clearTimeout(timer)
    timer = undefined
    pending = null
  }

  const flush = () => {
    timer = undefined
    const batch = pending
    pending = null
    if (batch) opts.send({ kind: 'append', ...batch })
  }

  return {
    append(session, entries, counts, apps) {
      if (pending && pending.session !== session) cancel()
      const queued = pending ? pending.entries.concat(entries) : entries.slice()
      // The renderer keeps no more than this either: drop the oldest first.
      const kept =
        queued.length > LOG_BUFFER_SIZE ? queued.slice(queued.length - LOG_BUFFER_SIZE) : queued
      pending = { session, entries: kept, counts, apps }
      if (timer === undefined) timer = timers.setTimeout(flush, intervalMs)
    },
    reset(session, entries, counts, apps) {
      cancel()
      opts.send({ kind: 'reset', session, entries, counts, apps })
    },
    state(session, state) {
      opts.send({ kind: 'state', session, state })
    },
    cancel
  }
}
