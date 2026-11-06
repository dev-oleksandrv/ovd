import type { AppSource, InstalledApp } from '@ovd/core'
import { timeText } from './packages.js'

const SOURCE: Record<AppSource, string> = {
  sideloaded: 'Side-loaded',
  store: 'Appstore',
  system: 'System'
}

export function statusText(app: InstalledApp): string {
  return app.status.state === 'running' ? `Running · pid ${app.status.pid}` : 'Stopped'
}

// One row per app: title, ID, version (build), status. Store and system apps are marked.
export function appsTable(apps: InstalledApp[]): string {
  const rows = apps.map((a) => [
    a.title,
    a.packageId,
    `${a.version || '—'} (${a.buildNumber})`,
    a.source === 'sideloaded' ? statusText(a) : `${statusText(a)} · ${a.source}`
  ])
  const widths = [0, 1, 2].map((col) => Math.max(...rows.map((r) => r[col]?.length ?? 0)))
  const line = (r: string[]) =>
    r.map((cell, col) => (col < widths.length ? cell.padEnd(widths[col] ?? 0) : cell)).join('  ')
  return `${rows.map(line).join('\n')}\n`
}

export function appRows(app: InstalledApp): string {
  const rows: [string, string][] = [
    ['Title', app.title],
    ['ID', app.packageId],
    ['Version', `${app.version || '—'} (${app.buildNumber})`],
    ['Source', SOURCE[app.source]],
    ['Installed', timeText(app.installedAt)],
    ['Updated', timeText(app.updatedAt)],
    ['Status', statusText(app)],
    ['Lifespan', app.status.state === 'running' ? app.status.lifespan : '—']
  ]
  const width = Math.max(...rows.map(([label]) => label.length))
  const head = rows.map(([label, value]) => `${label.padEnd(width)}  ${value}\n`).join('')
  if (app.components.length === 0) return head
  const comps = app.components.map((c) =>
    [c.id, c.type ?? '—', c.running ? `${c.running.state} · pid ${c.running.pid}` : 'STOPPED'].join(
      '  '
    )
  )
  return `${head}\nComponents\n${comps.map((c) => `  ${c}\n`).join('')}`
}
