import type { InstalledApp } from '@ovd/core'
import { KeyValueGrid } from '../../ui/KeyValueGrid'
import { StatusPill } from '../../ui/StatusPill'
import { cx } from '../../ui/cx'
import { AppAvatar } from './AppAvatar'
import { AppActions, type ReinstallPackage } from './AppActions'
import { componentRows, infoRows, statusView, type AppAction } from './appsView'
import type { LaunchOutcome } from './launchOutcomes'
import { LaunchStatus } from './LaunchStatus'

interface AppDetailProps {
  app: InstalledApp
  now: Date
  // The action running on this app, if any.
  busy: AppAction | undefined
  // The app's launch verification state for this session, if any.
  outcome: LaunchOutcome | undefined
  onAction: (action: AppAction, app: InstalledApp) => void
  reinstall: ReinstallPackage
  // "Open crash report" on a launch that crashed, by the report's vault index.
  onOpenCrash?: (id: number) => void
}

// The right-hand panel: what the device reports about one app, and the actions on it.
export function AppDetail({
  app,
  now,
  busy,
  outcome,
  onAction,
  reinstall,
  onOpenCrash
}: AppDetailProps) {
  const status = statusView(app, outcome)
  return (
    <aside
      aria-label={`${app.title} details`}
      className="flex min-h-0 flex-col gap-4 overflow-auto border-l border-line bg-sunken p-5"
    >
      <div className="flex items-center gap-3">
        <AppAvatar packageId={app.packageId} title={app.title} size="detail" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="m-0 truncate text-title font-semibold">{app.title}</h2>
          <div className="truncate font-mono text-label text-muted">{app.packageId}</div>
          <div>
            <StatusPill tone={status.tone} pulse={status.pulse ?? false}>
              {status.label}
            </StatusPill>
          </div>
        </div>
      </div>
      <LaunchStatus outcome={outcome} now={now} {...(onOpenCrash ? { onOpenCrash } : {})} />
      <AppActions app={app} busy={busy} onAction={onAction} reinstall={reinstall} />
      <KeyValueGrid items={infoRows(app, now)} />
      <section aria-label="Components" className="flex flex-col gap-2">
        <div className="text-label tracking-[.06em] text-subtle uppercase">
          Components · vpm info / vlcm list
        </div>
        <ul className="m-0 flex flex-col gap-2 p-0">
          {componentRows(app).map((c) => (
            <li
              key={c.id}
              className="flex list-none flex-col gap-1 rounded-field border border-line-soft bg-panel px-3 py-2.5"
            >
              <div className="font-mono text-meta">{c.id}</div>
              <div className="flex flex-wrap gap-2.5 text-meta text-muted">
                {c.type && <span>{c.type}</span>}
                <span className={cx(c.running && 'text-accent')}>{c.state}</span>
                <span>{c.pid}</span>
                <span className="truncate">{c.container}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
