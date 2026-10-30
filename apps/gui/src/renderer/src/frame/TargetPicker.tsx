import type { Device } from '@ovd/core'
import { useEffect, useRef } from 'react'
import { connectionLabel, dimmed, statusView, type VvdBusy } from '../screens/devices/deviceView'
import { cx } from '../ui/cx'
import { Icon } from '../ui/Icon'
import { StatusDot } from '../ui/StatusDot'
import { toneText } from '../ui/tone'

interface TargetPickerProps {
  devices: Device[]
  target: Device | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (device: Device) => void
  onPair: () => void
  vvdBusy?: VvdBusy
}

// The title bar's target switch. "Set up a new stick…" joins the menu with its slice
// (ADR 0018: no dead entries).
export function TargetPicker({
  devices,
  target,
  open,
  onOpenChange,
  onPick,
  onPair,
  vvdBusy = null
}: TargetPickerProps) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    const onDown = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open, onOpenChange])

  return (
    <div ref={root} className="relative flex-none">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Target device"
        onClick={() => onOpenChange(!open)}
        className="flex h-[30px] max-w-[360px] min-w-[230px] cursor-pointer items-center gap-2 rounded-field border border-line-menu bg-field px-2.5 hover:bg-field-hover"
      >
        <StatusDot tone={target ? statusView(target, vvdBusy).tone : 'muted'} size={8} />
        <span className="min-w-0 truncate font-medium">{target?.name ?? 'No device'}</span>
        {target?.info && (
          <span className="font-mono text-label text-muted">{target.info.architecture}</span>
        )}
        {target && (
          <span className="flex-none rounded-chip border border-line-strong px-1.5 py-px text-label whitespace-nowrap text-muted">
            {connectionLabel(target)}
          </span>
        )}
        <span className="flex-1" />
        <Icon name="unfold_more" className="text-muted" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Target device"
          className="absolute top-9 left-0 flex w-[340px] animate-enter flex-col gap-0.5 rounded-card border border-line-strong bg-raised p-1.5 shadow-popover"
        >
          <div className="px-2 pt-1.5 pb-1 text-label tracking-[.06em] text-faint uppercase">
            Target device
          </div>
          {devices.map((device) => {
            const status = statusView(device, vvdBusy)
            const arch = device.info?.architecture
            return (
              <button
                key={device.id}
                type="button"
                role="menuitemradio"
                aria-checked={device.id === target?.id}
                onClick={() => {
                  onOpenChange(false)
                  if (device.id !== target?.id) onPick(device)
                }}
                className={cx(
                  'flex cursor-pointer items-center gap-2.5 rounded-control p-2 text-left hover:bg-control-hover',
                  device.id === target?.id && 'bg-selected',
                  dimmed(device, vvdBusy) && 'opacity-55'
                )}
              >
                <StatusDot tone={status.tone} size={8} pulse={status.pulse} />
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="font-medium">{device.name}</span>
                  <span className="font-mono text-label text-muted">
                    {arch ? `${device.id} · ${arch}` : device.id}
                  </span>
                </span>
                <span className={cx('text-label', toneText[status.tone])}>{status.label}</span>
              </button>
            )
          })}
          <div className="mx-0.5 my-1 h-px bg-line-menu" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onOpenChange(false)
              onPair()
            }}
            className="flex cursor-pointer items-center gap-2 rounded-control p-2 text-left text-text-soft hover:bg-control-hover"
          >
            <Icon name="wifi_add" />
            Pair a device over Wi‑Fi…
          </button>
        </div>
      )}
    </div>
  )
}
