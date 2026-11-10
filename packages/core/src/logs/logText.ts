import type { Surface } from '../activity/activityLog.js'
import type { LogEntry, OvdEvent } from './types.js'

export interface LogTextOptions {
  // Wraps the level letter, e.g. in ANSI color for a terminal.
  paintLevel?: (level: LogEntry['level'], text: string) => string
}

const TAG_WIDTH = 24
const PID_WIDTH = 6

// Control characters in device text (an app's own `console.log`, a tag) would reach the
// terminal, or a viewer of the exported file, as escape sequences that move the cursor,
// recolor or rewrite lines, and bidi controls would reorder a line visually. They are shown as
// visible escapes instead: C0 (but tab and newline), DEL and C1 as `\xHH`, bidi as `\u{HHHH}`.
// `--json` keeps the device text exact.
const CONTROLS =
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

function escapeControls(text: string): string {
  return text.replace(CONTROLS, (char) => {
    const code = char.charCodeAt(0)
    return code <= 0xff
      ? `\\x${code.toString(16).padStart(2, '0')}`
      : `\\u{${code.toString(16).padStart(4, '0')}}`
  })
}

// The plain-text line format of `ovd logs` and of the desktop's Export, which must match, so
// it lives here as an export format (surfaces can't share code with each other):
// `HH:MM:SS.mmm L <tag> <pid> <message>` in host local time, continuation lines indented to
// the message column, control characters escaped (`escapeControls`).
export function logText(entry: LogEntry, opts: LogTextOptions = {}): string {
  const time = clock(new Date(entry.time))
  if (entry.ovd !== undefined) {
    // An OVD line: `HH:MM:SS.mmm OVD <message>`, the OVD column painted at the entry's level.
    const label = opts.paintLevel ? opts.paintLevel(entry.level, 'OVD') : 'OVD'
    return `${time} ${label} ${entry.message}\n`
  }
  const level = opts.paintLevel ? opts.paintLevel(entry.level, entry.level) : entry.level
  const pid = (entry.pid === null ? '-' : String(entry.pid)).padStart(PID_WIDTH)
  const columns = `${escapeControls(entry.tag).padEnd(TAG_WIDTH)} ${pid} `
  // The indent counts the unpainted prefix: paint adds invisible characters only.
  const indent = ' '.repeat(`${time} ${entry.level} ${columns}`.length)
  const head = `${time} ${level} ${columns}`
  const [first = '', ...rest] = escapeControls(entry.message).split('\n')
  return [head + first, ...rest.map((line) => indent + line)].join('\n') + '\n'
}

const SURFACE_PHRASE: Record<Surface, string> = {
  cli: 'from the CLI',
  desktop: 'from the desktop',
  mcp: 'from MCP',
  action: 'from the GitHub Action'
}

// The one English line of an OVD event. It lives next to `logText` because the CLI, the
// desktop list and Export must read the same, and the renderer can't import core runtime code
// (it gets the text with the entry as `message`).
export function ovdEventText(event: OvdEvent): string {
  switch (event.kind) {
    case 'install': {
      const reinstall = event.action === 'app.reinstall'
      const subject =
        (reinstall ? (event.app ?? event.package) : (event.package ?? event.app)) ?? 'the app'
      if (event.result === 'ok') {
        return `${reinstall ? 'Reinstalled' : 'Installed'} ${subject} ${SURFACE_PHRASE[event.surface]}`
      }
      return `${reinstall ? 'Reinstall' : 'Install'} of ${subject} failed: ${event.errorCode ?? 'unknown error'}`
    }
    case 'restarted':
      return 'Log session restarted'
    case 'disconnected':
      return 'Device dropped · reconnecting…'
    case 'reconnected':
      return 'Log session reconnected'
    case 'launch': {
      const what = event.action === 'app.restart' ? 'Restart' : 'Launch'
      const app = event.app ?? 'the app'
      switch (event.result) {
        case 'verified':
          return `${what} of ${app} verified`
        case 'crashed': {
          const details = [
            ...(event.pid === undefined ? [] : [`pid ${event.pid}`]),
            ...(event.signal === undefined ? [] : [event.signal])
          ]
          return `Crash detected: ${app}${details.length > 0 ? ` (${details.join(', ')})` : ''}`
        }
        case 'not-running':
          return `${what} of ${app} not verified: it isn’t running`
        case 'failed':
          return `${what} of ${app} failed: ${event.errorCode ?? 'unknown error'}`
      }
    }
  }
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
