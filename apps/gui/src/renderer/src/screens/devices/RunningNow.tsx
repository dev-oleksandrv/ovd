import type { Device } from '@ovd/core'
import { Card } from '../../ui/Card'
import { StatusDot } from '../../ui/StatusDot'
import { runningNowEmpty } from '../apps/appsView'
import { useApps } from '../apps/useApps'

interface RunningNowProps {
  device: Device
  // "All apps →" opens the Apps screen; absent where there is none.
  onOpenApps?: () => void
}

// Devices → "Running now" (Stage 2.4a): the side-loaded and Appstore apps running on this device.
export function RunningNow({ device, onOpenApps }: RunningNowProps) {
  const { state } = useApps(device.status === 'online' ? device.id : null, { running: true })
  const apps =
    'list' in state && state.list?.target.id === device.id
      ? state.list.apps.filter((a) => a.status.state === 'running')
      : []
  const empty =
    device.status !== 'online'
      ? runningNowEmpty(device)
      : state.status === 'error'
        ? state.error.message
        : state.status === 'ready' && apps.length === 0
          ? runningNowEmpty(device)
          : null
  return (
    <Card
      title="Running now"
      {...(onOpenApps
        ? {
            action: (
              <button
                type="button"
                onClick={onOpenApps}
                className="cursor-pointer text-small text-accent hover:text-accent-bright"
              >
                All apps →
              </button>
            )
          }
        : {})}
    >
      {apps.map((a) => (
        <div
          key={a.packageId}
          className="flex items-center gap-2.5 border-b border-line-row px-3.5 py-2.5 last:border-b-0"
        >
          <StatusDot tone="ok" size={6} />
          <span className="min-w-0 flex-1 truncate">{a.title}</span>
          {a.status.state === 'running' && (
            <span className="font-mono text-label whitespace-nowrap text-muted">
              pid {a.status.pid} · {a.components.find((c) => c.running)?.running?.state}
            </span>
          )}
        </div>
      ))}
      {empty !== null && <div className="p-3.5 text-muted">{empty}</div>}
    </Card>
  )
}
