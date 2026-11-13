import { signalName } from '../adapters/parseTombstones.js'
import type { ActivityEntry } from '../activity/activityLog.js'
import { ovdEventText } from './logText.js'
import type { LogEntry, OvdEvent } from './types.js'

// The OVD event an activity entry shows in a log session, or undefined for an action that
// shows none (`logs`, `logs.restart`, `app.uninstall`…).
export function ovdEventOf(entry: ActivityEntry): OvdEvent | undefined {
  const pkg = text(entry.args.package)
  const app = text(entry.args.app)
  switch (entry.action) {
    case 'app.install':
    case 'app.reinstall':
      return {
        kind: 'install',
        action: entry.action,
        surface: entry.surface,
        result: entry.result,
        ...(pkg === undefined ? {} : { package: pkg }),
        ...(app === undefined ? {} : { app }),
        ...(entry.result === 'error' && entry.errorCode !== undefined
          ? { errorCode: entry.errorCode }
          : {})
      }
    case 'app.launch':
    case 'app.restart': {
      const base = {
        kind: 'launch' as const,
        action: entry.action,
        surface: entry.surface,
        ...(app === undefined ? {} : { app })
      }
      if (entry.result === 'ok') return { ...base, result: 'verified' }
      const reason = entry.args.reason
      if (entry.errorCode === 'LAUNCH_NOT_VERIFIED' && reason === 'crashed') {
        const pid = pidOf(entry.args.pid)
        const signal = text(entry.args.signal)
        return {
          ...base,
          result: 'crashed',
          ...(pid === undefined ? {} : { pid }),
          ...(signal === undefined ? {} : { signal })
        }
      }
      if (entry.errorCode === 'LAUNCH_NOT_VERIFIED' && reason === 'not-running') {
        return { ...base, result: 'not-running' }
      }
      return {
        ...base,
        result: 'failed',
        ...(entry.errorCode === undefined ? {} : { errorCode: entry.errorCode })
      }
    }
    case 'build.changed': {
      const file = text(entry.args.file)
      if (file === undefined) return undefined
      const folder = text(entry.args.folder)
      return { kind: 'build', ...(folder === undefined ? {} : { folder }), file }
    }
    case 'crash.detected': {
      const pid = pidOf(entry.args.pid)
      const signal = signalOf(entry.args.signal)
      const index = pidOf(entry.args.index)
      return {
        kind: 'crash',
        ...(pkg === undefined ? {} : { app: pkg }),
        ...(pid === undefined ? {} : { pid }),
        ...(signal === undefined ? {} : { signal }),
        ...(index === undefined ? {} : { index })
      }
    }
    default:
      return undefined
  }
}

// An OVD line: no device fields, `tag: 'OVD'`, the event's text as its message.
export function ovdEntry(event: OvdEvent, time: string, seq: number): LogEntry {
  return {
    seq,
    time,
    deviceTime: null,
    level: 'I',
    priority: null,
    facility: null,
    process: null,
    pid: null,
    tid: null,
    tag: 'OVD',
    message: ovdEventText(event),
    parsed: true,
    ovd: event
  }
}

// The longest string an OVD line takes from an activity entry, in code points.
export const OVD_TEXT_MAX = 256

// C0 controls, DEL and C1 controls: none may reach a terminal from `activity.jsonl`, whose
// strings (a .vpkg file name, say) can carry escape sequences. Bidi formatting controls go too,
// so a crafted package or app name can't reorder an OVD line visually.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

// A string arg of the entry, without control characters and cut to OVD_TEXT_MAX with `…`.
function text(value: string | number | boolean | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const points = Array.from(value.replace(CONTROLS, ''))
  if (points.length === 0) return undefined
  return points.length > OVD_TEXT_MAX
    ? `${points.slice(0, OVD_TEXT_MAX - 1).join('')}…`
    : points.join('')
}

// `appActions.ts` writes the crash pid as a decimal string.
function pidOf(value: string | number | boolean | undefined): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return undefined
}

// The signal as the crash watcher writes it (a number): its name when OVD knows it.
function signalOf(value: string | number | boolean | undefined): string | undefined {
  const n = pidOf(value)
  return n === undefined ? undefined : (signalName(n) ?? `signal ${n}`)
}
