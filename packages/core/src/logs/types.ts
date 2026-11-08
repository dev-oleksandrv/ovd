// One level per entry, from its syslog priority (logLevel.ts). V is only a filter value: it
// means "everything", and no entry is ever V.
export type LogLevel = 'V' | 'D' | 'I' | 'W' | 'E'

// One log entry from `loggingctl log -f -o short_concise` (ARCHITECTURE §8).
export interface LogEntry {
  // Increases by one per entry within a session.
  seq: number
  // The entry's instant, ISO UTC. A line without a header gets the host time it arrived.
  time: string
  // The device time as printed (`Nov 08 07:27:00.257342`, UTC, no year), or null.
  deviceTime: string | null
  level: Exclude<LogLevel, 'V'>
  // The syslog priority as printed (`err`, `warning`…).
  priority: string | null
  facility: string | null
  // The syslog identity: an app's package ID or a process name.
  process: string | null
  pid: number | null
  tid: number | null
  tag: string
  // Continuation lines are joined with `\n`.
  message: string
  // false for a line that has no header and follows no entry: kept as is.
  parsed: boolean
}

export interface LogCounts {
  // Lines (entries) and E entries received since the start or the last Clear.
  lines: number
  errors: number
  // Buffered entries that match the filter.
  shown: number
}

// The desktop keeps this many entries (~100k lines, gui.md, Performance).
export const LOG_BUFFER_SIZE = 100_000
// And at most about this many bytes of them: it bounds memory when lines are huge (a JSON dump
// on one line), where the entry count alone doesn't.
export const LOG_BUFFER_BYTES = 64 * 1024 * 1024
