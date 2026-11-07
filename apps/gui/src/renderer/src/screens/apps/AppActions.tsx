import type { InstalledApp } from '@ovd/core'
import { Button } from '../../ui/Button'
import { BUSY_REASON, canUninstall, detailActions, type AppAction } from './appsView'

// Whether there is a package to reinstall: undefined while it is looked up.
export type ReinstallPackage =
  { ok: true; file: string } | { ok: false; reason: string } | undefined

interface AppActionsProps {
  app: InstalledApp
  busy: AppAction | undefined
  onAction: (action: AppAction, app: InstalledApp) => void
  reinstall: ReinstallPackage
}

const LABELS: Record<AppAction, string> = {
  launch: 'Launch',
  restart: 'Restart',
  terminate: 'Terminate',
  'force-stop': 'Force stop',
  reinstall: 'Uninstall & reinstall',
  uninstall: 'Uninstall'
}

// The detail's actions: Launch, or Restart, Terminate and Force stop; for side-loaded apps
// Uninstall & reinstall and Uninstall too.
export function AppActions({ app, busy, onAction, reinstall }: AppActionsProps) {
  const button = (action: AppAction, blocked?: string) => {
    const reason = busy !== undefined && busy !== action ? BUSY_REASON : blocked
    return (
      <Button
        key={action}
        size="sm"
        variant={action === 'launch' || action === 'restart' ? 'primary' : 'secondary'}
        loading={busy === action}
        disabled={reason !== undefined}
        {...(reason === undefined ? {} : { disabledReason: reason })}
        onClick={() => onAction(action, app)}
      >
        {LABELS[action]}
      </Button>
    )
  }
  const reinstallBlocked =
    reinstall === undefined ? 'Looking for a package…' : reinstall.ok ? undefined : reinstall.reason
  return (
    <section aria-label="Actions" className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">{detailActions(app).map((a) => button(a))}</div>
      {canUninstall(app) && (
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex flex-col gap-1">
            {button('reinstall', reinstallBlocked)}
            <span className="text-meta text-muted">clears app data (to be verified)</span>
          </div>
          {button('uninstall')}
        </div>
      )}
    </section>
  )
}
