import type { InstalledApp } from '@ovd/core'
import { Button } from '../../ui/Button'
import { BUSY_REASON, running, type AppAction } from './appsView'

interface RowActionProps {
  app: InstalledApp
  // The action running on this app, if any.
  busy: AppAction | undefined
  onAction: (action: AppAction, app: InstalledApp) => void
}

// The table row's Launch / Stop (graceful terminate).
export function RowAction({ app, busy, onAction }: RowActionProps) {
  const action: AppAction = running(app) ? 'terminate' : 'launch'
  return (
    // The row selects on click; the button's click must not reach it.
    <div onClick={(event) => event.stopPropagation()}>
      <Button
        size="sm"
        loading={busy === action}
        disabled={busy !== undefined && busy !== action}
        disabledReason={BUSY_REASON}
        onClick={() => onAction(action, app)}
      >
        {action === 'launch' ? 'Launch' : 'Stop'}
      </Button>
    </div>
  )
}
