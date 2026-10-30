import type { Device } from '@ovd/core'
import { cx } from '../../ui/cx'
import { Icon } from '../../ui/Icon'
import { StatusDot } from '../../ui/StatusDot'
import { toneText } from '../../ui/tone'
import { dimmed, statusView, subtitle, type VvdBusy } from './deviceView'

interface DeviceRowProps {
  device: Device
  selected: boolean
  onSelect: () => void
  vvdBusy?: VvdBusy
}

export function DeviceRow({ device, selected, onSelect, vvdBusy = null }: DeviceRowProps) {
  const status = statusView(device, vvdBusy)
  return (
    <li className="list-none">
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cx(
          'flex w-full cursor-pointer items-center gap-3 rounded-card border p-3 text-left hover:border-line-hover',
          selected ? 'border-accent-line bg-selected' : 'border-line-soft bg-panel',
          dimmed(device, vvdBusy) && 'opacity-60'
        )}
      >
        <span className="grid size-9 flex-none place-items-center rounded-tile bg-selected text-text-soft">
          <Icon name={device.kind === 'vvd' ? 'desktop_windows' : 'tv'} size={20} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold">{device.name}</span>
            {device.isTarget && (
              <span className="rounded-chip bg-accent/12 px-1.5 py-px text-micro text-accent">
                Target
              </span>
            )}
          </span>
          <span className="font-mono text-label text-muted">{subtitle(device)}</span>
        </span>
        <span className={cx('flex items-center gap-1.5 text-meta', toneText[status.tone])}>
          <StatusDot tone={status.tone} pulse={status.pulse} />
          {status.label}
        </span>
      </button>
    </li>
  )
}
