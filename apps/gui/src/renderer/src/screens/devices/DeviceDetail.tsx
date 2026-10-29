import type { Device } from '@ovd/core'
import { Button } from '../../ui/Button'
import { CodeBlock } from '../../ui/CodeBlock'
import { Icon } from '../../ui/Icon'
import { KeyValueGrid } from '../../ui/KeyValueGrid'
import { OfflineState } from '../../ui/OfflineState'
import { StatusDot } from '../../ui/StatusDot'
import { toneText } from '../../ui/tone'
import { DeviceName } from './DeviceName'
import { infoRows, kindLabel, serialLine, statusView } from './deviceView'

interface DeviceDetailProps {
  device: Device
  onRename: (name: string) => void
  onSetTarget: () => void
}

export function DeviceDetail({ device, onRename, onSetTarget }: DeviceDetailProps) {
  const status = statusView(device)
  const serial = serialLine(device)
  return (
    <div className="flex flex-col gap-[18px] overflow-auto px-6.5 py-[22px]">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="grid size-[52px] flex-none place-items-center rounded-palette bg-selected text-text-bright">
          <Icon name={device.kind === 'vvd' ? 'desktop_windows' : 'tv'} size={28} />
        </div>
        <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1">
          <DeviceName key={device.id} name={device.name} onRename={onRename} />
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 whitespace-nowrap text-muted">
            <StatusDot tone={status.tone} pulse={status.pulse} />
            <span className={toneText[status.tone]}>{status.label}</span>
            <span>·</span>
            <span>{kindLabel(device)}</span>
            <span>·</span>
            <span className="font-mono text-small">{device.id}</span>
          </div>
          {serial && <div className="font-mono text-meta text-subtle">{serial}</div>}
        </div>
        {!device.isTarget && device.status === 'online' && (
          <Button variant="primary" onClick={onSetTarget}>
            Use as target
          </Button>
        )}
      </div>

      {device.status === 'stopped' && (
        <div className="flex items-center gap-3 rounded-card border border-line-menu bg-row-hover px-4 py-3.5 text-text-soft">
          <Icon name="power_settings_new" size={20} className="text-muted" />
          The Virtual Device is stopped.
        </div>
      )}
      {device.status === 'offline' && (
        <OfflineState deviceName={device.name} title="Device info unavailable" />
      )}

      <KeyValueGrid items={infoRows(device)} />

      {device.info && (
        <div className="min-w-0">
          <CodeBlock title="vega device info" code={JSON.stringify(device.info.raw, null, 2)} />
        </div>
      )}
    </div>
  )
}
