import type { Device } from '@ovd/core'
import { useState } from 'react'
import { useFeedback } from '../../feedback/feedbackContext'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorState } from '../../ui/ErrorState'
import { LoadingState } from '../../ui/LoadingState'
import { DeviceDetail } from './DeviceDetail'
import { DeviceRow } from './DeviceRow'
import { useDevices } from './useDevices'

// Devices (Stage 1.3). Actions of later slices (pairing, setup, VVD start/stop) are not drawn
// until they ship (ADR 0018).
export function DevicesScreen() {
  const { state, rescan } = useDevices()
  const { notify } = useFeedback()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const onRescan = async (): Promise<void> => {
    const update = await rescan()
    if (update.ok) {
      notify({
        tone: 'info',
        text: `Rescanned · ${update.devices.length} devices`,
        cli: 'ovd devices'
      })
    } else {
      notify({ tone: 'error', text: update.error.message, cli: 'ovd devices' })
    }
  }

  const rename = async (device: Device, name: string): Promise<void> => {
    const cli = `ovd device rename ${device.id} "${name}"`
    const result = await window.ovd.devices.rename(device.id, name)
    if (result.ok) notify({ tone: 'ok', text: `Renamed to ${result.data.name}`, cli })
    else notify({ tone: 'error', text: result.error.message, cli })
  }

  const setTarget = async (device: Device): Promise<void> => {
    const cli = `ovd target set ${device.id}`
    const result = await window.ovd.devices.setTarget(device.id)
    if (result.ok) notify({ tone: 'info', text: `Target: ${result.data.name}`, cli })
    else notify({ tone: 'error', text: result.error.message, cli })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-line px-6 pt-5 pb-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-heading font-semibold tracking-[-0.015em]">Devices</h1>
          <div className="text-muted">
            Discovered over USB, TCP/IP and the local Virtual Device · refreshes every 2 s
          </div>
        </div>
        <Button variant="secondary" icon="refresh" onClick={onRescan}>
          Rescan
        </Button>
      </div>

      {state.status === 'loading' && <LoadingState label="Loading devices…" />}
      {state.status === 'error' && (
        <ErrorState title={state.error.message} hint={state.error.hint} />
      )}
      {state.status === 'ready' && (
        <Body
          devices={state.devices}
          target={state.target}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRename={rename}
          onSetTarget={setTarget}
        />
      )}
    </div>
  )
}

interface BodyProps {
  devices: Device[]
  target: string | null
  selectedId: string | null
  onSelect: (id: string) => void
  onRename: (device: Device, name: string) => void
  onSetTarget: (device: Device) => void
}

function Body({ devices, target, selectedId, onSelect, onRename, onSetTarget }: BodyProps) {
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
            />
          ))}
        </ul>
      </div>
      {selected ? (
        <DeviceDetail
          device={selected}
          onRename={(name) => onRename(selected, name)}
          onSetTarget={() => onSetTarget(selected)}
        />
      ) : (
        <EmptyState
          title="No devices yet"
          body="Start the Virtual Device, or set up a Fire TV stick with Developer Mode."
        />
      )}
    </div>
  )
}
