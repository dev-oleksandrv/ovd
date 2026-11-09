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

function text(value: string | number | boolean | undefined): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

// `appActions.ts` writes the crash pid as a decimal string.
function pidOf(value: string | number | boolean | undefined): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return undefined
}
