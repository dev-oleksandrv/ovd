import type { Device } from '@ovd/core'
import { useState } from 'react'
import { useDevicesContext } from '../../devices/devicesContext'
import { useFeedback } from '../../feedback/feedbackContext'
import { Button } from '../../ui/Button'
import { ErrorState } from '../../ui/ErrorState'
import { LoadingState } from '../../ui/LoadingState'
import { DevicesBody } from './DevicesBody'

interface DevicesScreenProps {
  // Opens the new-stick wizard.
  onSetup: () => void
  // Opens the pairing wizard.
  onPair: () => void
  // "All apps →" in a device's Running now.
  onOpenApps?: () => void
}

// Devices (Stage 1.3–1.7).
export function DevicesScreen({ onSetup, onPair, onOpenApps }: DevicesScreenProps) {
  const { state, rescan, setTarget, vvd, reboot } = useDevicesContext()
  const { notify } = useFeedback()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reconnecting, setReconnecting] = useState<string | null>(null)

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

  const reconnect = async (device: Device): Promise<void> => {
    if (reconnecting) return
    const cli = `ovd connect ${device.id}`
    setReconnecting(device.id)
    notify({ tone: 'info', text: `Reconnecting ${device.name}…`, cli })
    const result = await window.ovd.pairing.connect(device.id)
    setReconnecting(null)
    if (result.ok) notify({ tone: 'ok', text: `${device.name} is back online`, cli })
    else {
      notify({
        tone: 'error',
        text: `${result.error.message}. ${result.error.hint}`,
        cli,
        action: { label: 'Retry', run: () => void reconnect(device) }
      })
    }
  }

  const forget = async (device: Device): Promise<void> => {
    const cli = `ovd forget ${device.id}`
    const result = await window.ovd.pairing.forget(device.id)
    if (result.ok && result.data.switchedToUsb) {
      notify({ tone: 'ok', text: `Forgot ${device.name} · switching back to USB`, cli })
    } else if (result.ok) {
      notify({
        tone: 'warning',
        text: `Forgot ${device.name}. It stays in TCP/IP mode: on the TV, Settings → My Fire TV → Developer Options → Connection Mode → USB`,
        cli
      })
    } else notify({ tone: 'error', text: result.error.message, cli })
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
        <div className="flex gap-2">
          <Button variant="secondary" icon="refresh" onClick={onRescan}>
            Rescan
          </Button>
          <Button variant="secondary" icon="wifi_add" onClick={onPair}>
            Pair over Wi‑Fi
          </Button>
        </div>
      </div>

      {state.status === 'loading' && <LoadingState label="Loading devices…" />}
      {state.status === 'error' && (
        <ErrorState title={state.error.message} hint={state.error.hint} />
      )}
      {state.status === 'ready' && (
        <DevicesBody
          devices={state.devices}
          target={state.target}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRename={rename}
          onSetTarget={setTarget}
          vvd={vvd}
          reboot={reboot}
          reconnecting={reconnecting}
          onReconnect={(device) => void reconnect(device)}
          onForget={(device) => void forget(device)}
          onSetup={onSetup}
          {...(onOpenApps ? { onOpenApps } : {})}
        />
      )}
    </div>
  )
}
