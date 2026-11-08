import type { LogEntry } from './types.js'

export interface LogTextOptions {
  // Wraps the level letter, e.g. in ANSI color for a terminal.
  paintLevel?: (level: LogEntry['level'], text: string) => string
}

const TAG_WIDTH = 24
const PID_WIDTH = 6

// The plain-text line format of `ovd logs` and of the desktop's Export, which must match, so
// it lives here as an export format (surfaces can't share code with each other):
// `HH:MM:SS.mmm L <tag> <pid> <message>` in host local time, continuation lines indented to
// the message column.
export function logText(entry: LogEntry, opts: LogTextOptions = {}): string {
  const level = opts.paintLevel ? opts.paintLevel(entry.level, entry.level) : entry.level
  const pid = (entry.pid === null ? '-' : String(entry.pid)).padStart(PID_WIDTH)
  const columns = `${entry.tag.padEnd(TAG_WIDTH)} ${pid} `
  const time = clock(new Date(entry.time))
  // The indent counts the unpainted prefix: paint adds invisible characters only.
  const indent = ' '.repeat(`${time} ${entry.level} ${columns}`.length)
  const head = `${time} ${level} ${columns}`
  const [first = '', ...rest] = entry.message.split('\n')
  return [head + first, ...rest.map((line) => indent + line)].join('\n') + '\n'
}

export function logTextAll(entries: LogEntry[]): string {
  return entries.map((entry) => logText(entry)).join('')
}

function clock(date: Date): string {
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.${String(
    date.getMilliseconds()
  ).padStart(3, '0')}`
}
