import type { Device } from '@ovd/core'
import { Button } from '../../ui/Button'
import { CodeBlock } from '../../ui/CodeBlock'
import { Icon } from '../../ui/Icon'
import { KeyValueGrid } from '../../ui/KeyValueGrid'
import { OfflineState } from '../../ui/OfflineState'
import { StatusDot } from '../../ui/StatusDot'
import { toneText } from '../../ui/tone'
import { DeviceName } from './DeviceName'
import { infoRows, kindLabel, serialLine, statusView, usable, type VvdBusy } from './deviceView'

interface DeviceDetailProps {
  device: Device
  onRename: (name: string) => void
  onSetTarget: () => void
  // Virtual Device controls; absent where they aren't offered.
  vvd?: {
    busy: VvdBusy
    enabling: boolean
    onStart: () => void
    onStop: () => void
    onEnableDeveloperMode: () => void
  }
}

export function DeviceDetail({ device, onRename, onSetTarget, vvd }: DeviceDetailProps) {
  const busy = vvd?.busy ?? null
  const status = statusView(device, busy)
  const isVvd = device.kind === 'vvd' && vvd !== undefined
  // The core status already says `starting` while a start from elsewhere boots.
  const running = device.status === 'online' || device.status === 'starting'
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
        <div className="flex flex-wrap gap-2">
          {!device.isTarget && usable(device, busy) && (
            <Button variant="primary" onClick={onSetTarget}>
              Use as target
            </Button>
          )}
          {isVvd && (
            <Button
              icon={running ? 'stop_circle' : 'play_circle'}
              loading={busy !== null}
              onClick={running ? vvd.onStop : vvd.onStart}
            >
              {busy === 'stop'
                ? 'Stopping…'
                : busy === 'start'
                  ? 'Starting…'
                  : running
                    ? 'Stop'
                    : 'Start'}
            </Button>
          )}
        </div>
      </div>

      {device.status === 'stopped' && busy === null && (
        <div className="flex items-center gap-3 rounded-card border border-line-menu bg-row-hover px-4 py-3.5">
          <Icon name="power_settings_new" size={20} className="text-muted" />
          <div className="flex-1 text-text-soft">The Virtual Device is stopped.</div>
          {isVvd && (
            <Button variant="primary" size="sm" onClick={vvd.onStart}>
              Start Virtual Device
            </Button>
          )}
        </div>
      )}
      {isVvd && usable(device, busy) && device.info?.developerMode === false && (
        <div className="flex items-center gap-3 rounded-card border border-line-menu bg-row-hover px-4 py-3.5">
          <Icon name="developer_mode" size={20} className="text-warning" />
          <div className="flex flex-1 flex-col gap-[3px]">
            <div className="text-text-soft">Developer Mode is off on the Virtual Device.</div>
            <div className="text-small text-muted">It’s needed to install and debug apps.</div>
          </div>
          <Button
            variant="primary"
            size="sm"
            loading={vvd.enabling}
            onClick={vvd.onEnableDeveloperMode}
          >
            {vvd.enabling ? 'Enabling…' : 'Enable Developer Mode'}
          </Button>
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
