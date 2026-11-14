import { createLogStreamParser } from '../../src/adapters/parseLogStream.js'
import type { LogEntry } from '../../src/logs/types.js'

// Parses `loggingctl log -o short_concise` text the way the session does, numbering the
// entries from 0.
export function parseLines(text: string, now = new Date('2026-11-08T12:00:00Z')): LogEntry[] {
  const parser = createLogStreamParser({ now: () => now })
  return [...parser.push(text), ...parser.end()].map((entry, seq) => ({ ...entry, seq }))
}

// One `short_concise` line with the sample host name.
export function logLine(opts: {
  time: string
  identity: string
  pid?: number
  tid?: number
  facility?: string
  priority?: string
  tag?: string
  message: string
}): string {
  const { time, identity, pid = 100, tid = 200, facility = 'local0', priority = 'info' } = opts
  const level = { err: 'ERROR', warning: 'WARNING', debug: 'DEBUG' }[priority] ?? 'INFO'
  const tag = opts.tag ?? 'com.amazon.keplerscript'
  return `Nov 08 ${time} firestick-0000000000000001 ${facility}.${priority} ${identity}[${pid}]: ${tid} ${level} ${tag}: ${opts.message}\n`
}
