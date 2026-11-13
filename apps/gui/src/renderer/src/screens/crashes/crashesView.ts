import type { Crash, CrashKind, Device } from '@ovd/core'
import type { KeyValue } from '../../ui/KeyValueGrid'
import { installedText } from '../apps/appsView'
import { shellQuote } from '../logs/logsView'

export const CRASHES_SUBTITLE = 'loggingctl vault · scoped to your apps · polling every 5 s'

export function crashesCli(device: string): string {
  return `ovd crashes --device ${shellQuote(device)}`
}

export function crashPullCli(id: number, device: string): string {
  return `ovd crash pull ${id} --device ${shellQuote(device)}`
}

// Why the list can't be read, or null when it can.
export function crashesBlocker(target: Device | undefined): 'no-target' | 'offline' | null {
  if (!target) return 'no-target'
  return target.status === 'online' ? null : 'offline'
}

const KIND_LABEL: Record<CrashKind, string> = { js: 'js', native: 'native' }

export function kindLabel(kind: CrashKind): string {
  return KIND_LABEL[kind]
}

// "just now", "12 s ago", "5 min ago", "3 h ago", then the date as Apps shows it.
export function ageText(iso: string, now: Date): string {
  const seconds = Math.floor((now.getTime() - new Date(iso).getTime()) / 1000)
  if (!Number.isFinite(seconds)) return '—'
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds} s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`
  return installedText(iso, now)
}

// The row's one-line cause: the report's summary, else the signal.
export function crashSummary(crash: Crash): string {
  return crash.summary ?? crash.signalName ?? `signal ${crash.signal}`
}

// `AppVersion (AppBuildNumber)`, or what the report has of it.
export function buildText(crash: Crash): string {
  if (crash.version && crash.build) return `${crash.version} (${crash.build})`
  return crash.version ?? (crash.build ? `build ${crash.build}` : '—')
}

// The row's second line: `pid · build · device`.
export function metaLine(crash: Crash, deviceName: string): string {
  return [`pid ${crash.pid}`, buildText(crash), deviceName].join(' · ')
}

// The toast of a crash that appeared: "<app> crashed · <summary>".
export function crashToastText(crash: Crash): string {
  return `${crash.package} crashed · ${crashSummary(crash)}`
}

export function detailRows(crash: Crash, now: Date): KeyValue[] {
  return [
    { label: 'Crash id', value: String(crash.id), mono: true },
    { label: 'Process', value: String(crash.pid), mono: true },
    {
      label: 'Signal',
      value: crash.signalName ? `${crash.signal} · ${crash.signalName}` : String(crash.signal),
      mono: true
    },
    { label: 'Time', value: `${installedText(crash.time, now)} · ${ageText(crash.time, now)}` },
    { label: 'Version', value: buildText(crash), mono: true }
  ]
}

export const NO_STACK = 'This report has no JavaScript stack.'
