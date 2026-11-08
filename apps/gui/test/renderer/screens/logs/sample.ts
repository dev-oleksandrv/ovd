import type { LogEntry } from '@ovd/core'

// Entries shaped as core parses fixtures/0.24/loggingctl-log/stick-follow.txt.
export function logEntry(seq: number, over: Partial<LogEntry> = {}): LogEntry {
  return {
    seq,
    time: '2026-11-08T07:27:00.257Z',
    deviceTime: 'Nov 08 07:27:00.257342',
    level: 'I',
    priority: 'info',
    facility: 'user',
    process: 'com.example.player',
    pid: 27178,
    tid: 2842092448,
    tag: 'com.amazon.keplerscript',
    message: `[KeplerScript-JavaScript] player flood ${seq}`,
    parsed: true,
    ...over
  }
}

export const entries = (n: number, from = 0): LogEntry[] =>
  Array.from({ length: n }, (_, i) => logEntry(from + i))
