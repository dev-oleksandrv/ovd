import type {
  Device,
  InstalledApp,
  LaunchResult,
  ReinstallResult,
  RestartResult,
  TerminateResult,
  UninstallResult
} from '@ovd/core'
import type { KeyValue } from '../../ui/KeyValueGrid'
import type { Tone } from '../../ui/tone'
import { whenText } from '../packages/packagesView'

export type AppTab = 'installed' | 'running'

export type AppAction =
  'launch' | 'terminate' | 'force-stop' | 'restart' | 'uninstall' | 'reinstall'

// Why an app's other actions are disabled while one runs.
export const BUSY_REASON = 'Another action is running on this app'

export type AppActionResult =
  LaunchResult | TerminateResult | RestartResult | UninstallResult | ReinstallResult

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
// with launch verification (2.5).
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

// The design's info rows. The device reports no build type, size or run time for an installed
// app (ARCHITECTURE §8), so Build type, Size and Running for stay "—".
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

// The `ovd apps …` each desktop action echoes (ADR 0005).
export function appActionCli(action: AppAction, packageId: string, device: string): string {
  const verb = action === 'force-stop' ? 'terminate' : action
  const force = action === 'force-stop' ? ' --force' : ''
  return `ovd apps ${verb} ${packageId}${force} --device ${device}`
}

// The detail's run actions: Launch for a stopped app; Restart, Terminate, Force stop for a
// running one.
export function detailActions(app: InstalledApp): AppAction[] {
  return running(app) ? ['restart', 'terminate', 'force-stop'] : ['launch']
}

// OVD only uninstalls what the developer side-loaded, never Appstore or system apps.
export function canUninstall(app: InstalledApp): boolean {
  return app.source === 'sideloaded'
}

const DONE: Record<AppAction, string> = {
  launch: 'Launched',
  terminate: 'Stopped',
  'force-stop': 'Force stopped',
  restart: 'Restarted',
  uninstall: 'Uninstalled',
  reinstall: 'Reinstalled'
}

export function actionToast(
  action: AppAction,
  app: InstalledApp,
  result: AppActionResult
): { tone: 'ok' | 'info'; text: string } {
  if (action === 'terminate' && 'wasRunning' in result && result.wasRunning === false) {
    return { tone: 'info', text: `${app.title} wasn’t running` }
  }
  return { tone: 'ok', text: `${DONE[action]} ${app.title}` }
}

// The list's fresh state with the detail's component types. The detail is cached by update
// time, which a launch or stop doesn't change, so its running state would be stale.
export function withDetail(current: InstalledApp, detail: InstalledApp | undefined): InstalledApp {
  if (!detail || detail.packageId !== current.packageId) return current
  return {
    ...current,
    components: current.components.map((c) => {
      const read = detail.components.find((d) => d.id === c.id)
      return {
        ...c,
        ...(read?.type ? { type: read.type } : {}),
        ...(read?.launchType ? { launchType: read.launchType } : {})
      }
    })
  }
}
