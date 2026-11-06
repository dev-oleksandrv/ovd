import type { Device, InstalledApp } from '@ovd/core'
import type { KeyValue } from '../../ui/KeyValueGrid'
import type { Tone } from '../../ui/tone'
import { whenText } from '../packages/packagesView'

export type AppTab = 'installed' | 'running'

export function appsCli(device: string): string {
  return `ovd apps --device ${device}`
}

export function appInfoCli(packageId: string, device: string): string {
  return `ovd apps info ${packageId} --device ${device}`
}

export function running(app: InstalledApp): boolean {
  return app.status.state === 'running'
}

// "Running · 4182" / "Stopped" (design `status`). "Verifying…" and "Crashed on launch" come
// with launches (2.4b, 2.5).
export function statusView(app: InstalledApp): { tone: Tone; label: string } {
  return app.status.state === 'running'
    ? { tone: 'ok', label: `Running · ${app.status.pid}` }
    : { tone: 'muted', label: 'Stopped' }
}

export function tabCounts(apps: InstalledApp[]): Record<AppTab, number> {
  return { installed: apps.length, running: apps.filter(running).length }
}

export function visibleApps(apps: InstalledApp[], tab: AppTab): InstalledApp[] {
  return tab === 'running' ? apps.filter(running) : apps
}

// "Today 14:02", or "Oct 12" before today (design `when`).
export function installedText(iso: string, now: Date): string {
  const text = whenText(iso, now)
  return text.includes(':') ? `Today ${text}` : text
}

// The design's info rows. Build type, Size and Running for come from OVD's own installs and
// launches (2.4b); the device reports none of them, so they show "—" until then.
export function infoRows(app: InstalledApp, now: Date): KeyValue[] {
  return [
    { label: 'Version', value: `${app.version || '—'} (${app.buildNumber})`, mono: true },
    { label: 'Build type', value: '—' },
    { label: 'Size', value: '—' },
    { label: 'Installed', value: installedText(app.installedAt, now) },
    {
      label: 'Lifespan',
      value: app.status.state === 'running' ? app.status.lifespan : '—',
      mono: true
    },
    { label: 'Running for', value: '—' }
  ]
}

export interface ComponentRow {
  id: string
  type: string
  state: string
  pid: string
  container: string
  running: boolean
}

// "Components · vpm info / vlcm list". `type` needs `vpm info` per component, which only the
// detail reads; until then it is blank.
export function componentRows(app: InstalledApp): ComponentRow[] {
  return app.components.map((c) => ({
    id: c.id,
    type: c.type ?? '',
    state: c.running?.state ?? 'STOPPED',
    pid: c.running ? `pid ${c.running.pid}` : 'pid —',
    container: c.running?.container ?? '—',
    running: c.running !== undefined
  }))
}

// Why the list can't be read, or null when it can.
export function appsBlocker(target: Device | undefined): 'no-target' | 'offline' | null {
  if (!target) return 'no-target'
  return target.status === 'online' ? null : 'offline'
}

// Devices → "Running now" when nothing is listed (design `runEmptyText`).
export function runningNowEmpty(device: Device): string {
  if (device.kind === 'vvd' && device.status !== 'online') return 'Virtual Device is stopped'
  if (device.status !== 'online') return 'Device is offline'
  return 'No apps running'
}
