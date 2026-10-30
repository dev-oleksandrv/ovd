import type { Device } from '@ovd/core'
import { connectionLabel } from '../screens/devices/deviceView'
import { Icon } from '../ui/Icon'
import { StatusDot } from '../ui/StatusDot'

// The paired device as Devices lists it, on the wizard's last step.
export function PairedCard({ device }: { device: Device }) {
  const arch = device.info?.architecture
  return (
    <div className="flex items-center gap-3 rounded-card border border-line-menu bg-input p-3">
      <span className="grid size-9 flex-none place-items-center rounded-tile bg-selected text-text-soft">
        <Icon name="tv" size={20} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="font-semibold">{device.name}</div>
        <div className="font-mono text-meta text-muted">
          {[device.id, connectionLabel(device), arch].filter(Boolean).join(' · ')}
        </div>
        {device.serial && (
          <div className="font-mono text-meta text-faint">Serial {device.serial}</div>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-small text-accent">
        <StatusDot tone="ok" size={7} />
        Online
      </div>
    </div>
  )
}
