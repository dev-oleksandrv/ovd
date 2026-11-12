import type { Ref } from 'react'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { Chip } from '../../ui/Chip'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorState } from '../../ui/ErrorState'
import { LoadingState } from '../../ui/LoadingState'
import { latestLabel, LIVE_LABEL, noSignalText, type ScreenView } from './screenPanelView'

interface ScreenPanelProps {
  view: ScreenView
  // The live view's canvas.
  canvasRef?: Ref<HTMLCanvasElement>
  // The stick's latest screenshot.
  url?: string | null
  busy?: boolean
  onRefresh?: () => void
  onRetry?: () => void
}

// The target's screen above the remote (Stage 4.4): the Virtual Device's live view, or a stick's
// latest screenshot with Refresh. Copy other than the ROADMAP's is provisional (no design yet).
export function ScreenPanel({
  view,
  canvasRef,
  url,
  busy = false,
  onRefresh,
  onRetry
}: ScreenPanelProps) {
  const refresh = (
    <Button size="sm" icon="refresh" loading={busy} onClick={onRefresh}>
      {busy ? 'Taking a screenshot…' : 'Refresh'}
    </Button>
  )
  const action =
    view.kind === 'live' ? (
      <Chip variant="accent">{LIVE_LABEL}</Chip>
    ) : view.kind === 'stick' ? (
      <div className="flex items-center gap-2">
        {view.stale && <Chip>Out of date</Chip>}
        {view.shot && (
          <span className="text-label text-muted">{latestLabel(view.shot.takenAt)}</span>
        )}
        {view.shot && refresh}
      </div>
    ) : undefined

  return (
    <Card title="Screen" action={action} sunken>
      <div className="flex aspect-video w-full max-w-[640px] self-center overflow-hidden">
        {view.kind === 'live' ? (
          <canvas
            ref={canvasRef}
            aria-label={LIVE_LABEL}
            className="h-full w-full object-contain"
          />
        ) : view.kind === 'connecting' ? (
          <LoadingState label={`Connecting to the screen of ${view.name}…`} />
        ) : view.kind === 'waiting' ? (
          <LoadingState label={`Waiting for ${view.name}…`} />
        ) : view.kind === 'no-signal' ? (
          <EmptyState title="No signal" body={noSignalText(view.name, view.status)} />
        ) : view.kind === 'error' ? (
          <ErrorState
            title={view.error.message}
            hint={view.error.hint}
            actions={
              <Button icon="restart_alt" onClick={onRetry}>
                Retry
              </Button>
            }
          />
        ) : view.shot && url ? (
          <img
            src={url}
            alt={latestLabel(view.shot.takenAt)}
            className="h-full w-full object-contain"
          />
        ) : view.shot ? (
          <LoadingState label="Reading the screenshot…" />
        ) : (
          <EmptyState
            title="No screenshot yet"
            body="A stick has no live view. Refresh takes a screenshot of its screen."
            actions={refresh}
          />
        )}
      </div>
    </Card>
  )
}
