import type { Device } from '@ovd/core'
import { statusView, usable, type VvdBusy } from '../screens/devices/deviceView'
import { cx } from '../ui/cx'
import { StatusDot } from '../ui/StatusDot'
import { toneText } from '../ui/tone'

interface TargetStatusProps {
  target: Device | undefined
  onClick: () => void
  vvdBusy?: VvdBusy
}

export function TargetStatus({ target, onClick, vvdBusy = null }: TargetStatusProps) {
  if (!target) return null
  const status = statusView(target, vvdBusy)
  const online = usable(target, vvdBusy)
  return (
    <button
      type="button"
      aria-label={`Target: ${target.name}`}
      onClick={onClick}
      className="flex min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden whitespace-nowrap hover:text-text"
    >
      <StatusDot tone={status.tone} size={6} pulse={status.pulse} />
      <span className={cx(!online && 'opacity-60')}>{target.name}</span>
      {target.info && (
        <span className="font-mono text-label text-faint">{target.info.architecture}</span>
      )}
      {!online && <span className={toneText[status.tone]}>{status.label}</span>}
    </button>
  )
}
