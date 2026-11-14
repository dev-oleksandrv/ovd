import {
  escapeControls,
  logText,
  type Crash,
  type CrashesList,
  type CrashPullResult,
  type LogEntry,
  type OvdEvent
} from '@ovd/core'

// Device text (a report's summary, version, build, a device name) must not reach the terminal as
// escape sequences: shown as visible escapes exactly as `ovd logs` does (core's `escapeControls`):
// C0 (but tab and newline), DEL and C1 as `\xHH`, bidi as `\u{HHHH}`. `--json` keeps the text exact.

// One line of text: the escapes above, and no line breaks.
function oneLine(text: string): string {
  return escapeControls(text).replace(/[\t\n]+/g, ' ')
}

// "just now", "5 min ago", "3 h ago", "2 d ago".
export function ageText(time: string, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(time).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`
  return `${Math.floor(seconds / 86_400)} d ago`
}

function details(crash: Crash): string {
  const build =
    crash.version === undefined
      ? undefined
      : `${oneLine(crash.version)}${crash.build === undefined ? '' : ` (${oneLine(crash.build)})`}`
  return [`pid ${crash.pid}`, build].filter((part) => part !== undefined).join(' · ')
}

function cells(crash: Crash, now: Date): string[] {
  return [
    String(crash.id),
    crash.kind,
    crash.package,
    crash.new ? 'NEW' : '',
    ageText(crash.time, now),
    details(crash),
    crash.summary === undefined ? '' : oneLine(crash.summary)
  ]
}

function table(rows: string[][]): string {
  // The last column isn't padded, so lines carry no trailing spaces.
  const widths = (rows[0] ?? [])
    .slice(0, -1)
    .map((_, col) => Math.max(...rows.map((r) => r[col]?.length ?? 0)))
  return rows
    .map((row) =>
      row
        .map((cell, col) => (col < widths.length ? cell.padEnd(widths[col] ?? 0) : cell))
        .join('  ')
        .trimEnd()
    )
    .join('\n')
}

// `ovd crashes`: newest first, one line per report:
//   105  js  com.example.player  NEW  2 min ago  pid 7746 · 0.1.0 (1)  Error: …
export function crashesTable(list: CrashesList, now: Date = new Date()): string {
  if (list.crashes.length === 0) {
    return `No crashes of your apps on ${oneLine(list.device)}.\n`
  }
  return `${table(list.crashes.map((crash) => cells(crash, now)))}\n`
}

// A report that appeared while watching.
export function crashLine(crash: Crash, now: Date = new Date()): string {
  return `${table([cells(crash, now)])}\n`
}

// "Saved /…/com.example.player-1762568340-7746.acr (301471 bytes): crash 105 of com.example.player".
export function pulledLine(result: CrashPullResult): string {
  return `Saved ${result.path} (${result.bytes} bytes): crash ${result.crash.id} of ${result.crash.package}\n`
}

// `ovd crashes --watch`'s OVD lines, in the shape `ovd logs` prints them: the text line
// (`HH:MM:SS.mmm OVD …`, from core's `logText`) and the `--json` object.
export type WatchNote = 'away' | 'back'

function noteEvent(note: WatchNote): OvdEvent {
  return note === 'away' ? { kind: 'disconnected' } : { kind: 'reconnected' }
}

export function noteMessage(note: WatchNote, device: { name: string } | undefined): string {
  const who = device === undefined ? 'The target' : oneLine(device.name)
  return note === 'away'
    ? `${who} went away · still watching for crashes`
    : `${who} is back · watching for crashes`
}

function noteEntry(note: WatchNote, message: string, time: string): LogEntry {
  return {
    seq: 0,
    time,
    deviceTime: null,
    level: 'I',
    priority: null,
    facility: null,
    process: null,
    pid: null,
    tid: null,
    tag: 'OVD',
    message,
    parsed: true,
    ovd: noteEvent(note)
  }
}

export function noteText(note: WatchNote, message: string, time: string): string {
  return logText(noteEntry(note, message, time))
}

export function noteJson(note: WatchNote, message: string, time: string): object {
  return { time, ovd: noteEvent(note), message }
}
