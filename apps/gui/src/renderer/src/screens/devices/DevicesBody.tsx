import type { Device } from '@ovd/core'
import type { VvdActions } from '../../devices/useVvdActions'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { DeviceDetail } from './DeviceDetail'
import { DeviceRow } from './DeviceRow'
import { SetupHint } from './SetupHint'

interface DevicesBodyProps {
  devices: Device[]
  target: string | null
  selectedId: string | null
  onSelect: (id: string) => void
  onRename: (device: Device, name: string) => void
  onSetTarget: (device: Device) => void
  vvd: VvdActions
  reconnecting: string | null
  onReconnect: (device: Device) => void
  onForget: (device: Device) => void
  onSetup: () => void
}

export function DevicesBody({
  devices,
  target,
  selectedId,
  onSelect,
  onRename,
  onSetTarget,
  vvd,
  reconnecting,
  onReconnect,
  onForget,
  onSetup
}: DevicesBodyProps) {
  const selected =
    devices.find((d) => d.id === selectedId) ?? devices.find((d) => d.id === target) ?? devices[0]
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(250px,360px)_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col border-r border-line">
        <ul aria-label="Devices" className="m-0 flex flex-1 flex-col gap-2 overflow-auto p-3.5">
          {devices.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              selected={device.id === selected?.id}
              onSelect={() => onSelect(device.id)}
              vvdBusy={vvd.busy}
            />
          ))}
          {devices.length > 0 && (
            <li className="list-none">
              <SetupHint onSetup={onSetup} />
            </li>
          )}
        </ul>
      </div>
      {selected ? (
        <DeviceDetail
          device={selected}
          onRename={(name) => onRename(selected, name)}
          onSetTarget={() => onSetTarget(selected)}
          vvd={{
            busy: vvd.busy,
            enabling: vvd.enabling,
            onStart: () => void vvd.start(),
            onStop: () => void vvd.stop(),
            onEnableDeveloperMode: () => void vvd.enableDeveloperMode()
          }}
          saved={{
            reconnecting: reconnecting === selected.id,
            onReconnect: () => onReconnect(selected),
            onForget: () => onForget(selected)
          }}
        />
      ) : (
        <EmptyState
          title="No devices yet"
          body="Start the Virtual Device, or set up a Fire TV stick with Developer Mode."
          actions={
            <>
              <Button
                variant="primary"
                icon="desktop_windows"
                loading={vvd.busy === 'start'}
                onClick={() => void vvd.start()}
              >
                Start the Virtual Device
              </Button>
              <Button icon="developer_mode_tv" onClick={onSetup}>
                Set up a Fire TV stick
              </Button>
            </>
          }
        />
      )}
    </div>
  )
}
