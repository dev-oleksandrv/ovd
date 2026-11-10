import type { Surface } from '../activity/activityLog.js'
import type { ErrorCode } from '../errors/ovdError.js'

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
  // Set on an OVD line: one of OVD's own events, shown inline with `tag: 'OVD'` and no device
  // fields (`deviceTime`, `process`, `pid`, `tid` are null).
  ovd?: OvdEvent
}

// OVD's own events shown inline in a log session (`ovdEventText` gives their one line). Open to
// new kinds.
export type OvdEvent =
  | {
      kind: 'install'
      action: 'app.install' | 'app.reinstall'
      surface: Surface
      result: 'ok' | 'error'
      package?: string
      app?: string
      errorCode?: ErrorCode
    }
  | { kind: 'restarted'; reason: 'install' }
  | { kind: 'disconnected' }
  | { kind: 'reconnected' }
  | {
      kind: 'launch'
      action: 'app.launch' | 'app.restart'
      surface: Surface
      app?: string
      result: 'verified' | 'crashed' | 'not-running' | 'failed'
      pid?: number
      signal?: string
      errorCode?: ErrorCode
    }
  // A watched build folder got a new build (`ovd run --watch`, the desktop's Watch): `folder`
  // is relative to the project (`build/aarch64-debug/`).
  | { kind: 'build'; folder?: string; file: string }

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
