import { useEffect } from 'react'
import { targetDevice, useDevicesContext } from '../../devices/devicesContext'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorState } from '../../ui/ErrorState'
import { LoadingState } from '../../ui/LoadingState'
import { OfflineState } from '../../ui/OfflineState'
import { useScreenshot } from '../../screenshot/screenshotContext'
import { CapturesPanel } from './CapturesPanel'
import { InputSessionPanel } from './InputSessionPanel'
import { KeyboardHint } from './KeyboardHint'
import { keyFor, overlayOpen } from './remoteKeys'
import { remoteView } from './remoteView'
import { RemotePad } from './RemotePad'
import { TypeIntoTv } from './TypeIntoTv'
import { useInput } from './useInput'

interface RemoteScreenProps {
  // Opens the title bar's target picker.
  onSwitchTarget: () => void
}

// Debug → Remote & Screen (Stage 4.2): the target's remote and "Type into TV", through one
// input session main keeps open (sticks: inputd-cli, the Virtual Device: emulator gRPC).
export function RemoteScreen({ onSwitchTarget }: RemoteScreenProps) {
  const { state: devices } = useDevicesContext()
  const target = targetDevice(devices)
  const input = useInput(target)
  const view = devices.status === 'loading' ? null : remoteView(target, input.state)
  const ready = view?.kind === 'ready'
  const backend = ready ? view.state.backend : null
  const { press } = input
  const shot = useScreenshot()
  const { refresh } = shot

  // The captures folder can change outside OVD (files removed, another surface's takes): it is
  // read again when the screen mounts and whenever the window gets focus.
  useEffect(() => {
    void refresh()
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  // The keyboard's remote, only while this screen shows a ready session.
  useEffect(() => {
    if (!ready) return
    const onKey = (event: KeyboardEvent): void => {
      const key = keyFor(event, { backend, overlayOpen: overlayOpen() })
      if (key === null) return
      event.preventDefault()
      void press(key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ready, backend, press])

  const body =
    view === null ? (
      <LoadingState label="Looking for devices…" />
    ) : view.kind === 'no-target' ? (
      <EmptyState
        title="No target device"
        body="Pick a device in the title bar to use its remote."
        actions={<Button onClick={onSwitchTarget}>Choose a target</Button>}
      />
    ) : view.kind === 'offline' ? (
      <OfflineState
        deviceName={view.name}
        title="Remote unavailable"
        actions={<Button onClick={onSwitchTarget}>Switch target</Button>}
      />
    ) : view.kind === 'loading' ? (
      <LoadingState label={`Connecting the remote to ${view.name}…`} />
    ) : view.kind === 'error' ? (
      <ErrorState
        title={view.state.error?.message ?? 'The remote couldn’t connect'}
        hint={view.state.error?.hint ?? 'Check the device with ovd devices, then retry'}
        actions={
          <Button icon="restart_alt" onClick={input.retry}>
            Retry
          </Button>
        }
      />
    ) : (
      <div className="flex min-h-0 flex-1 gap-6 overflow-auto px-6 py-5">
        <div className="flex flex-col gap-4">
          <RemotePad backend={backend} flash={input.flash} onPress={(key) => void press(key)} />
          <KeyboardHint backend={backend} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <TypeIntoTv asciiOnly={backend === 'grpc'} onSend={input.text} />
          <InputSessionPanel state={view.state} />
          <CapturesPanel platform={window.ovd.platform} />
        </div>
      </div>
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-4 border-b border-line px-6 pt-5 pb-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="m-0 text-heading font-semibold tracking-[-0.015em]">Remote & Screen</h1>
          <div className="text-muted">
            {target ? `Remote of ${target.name}` : 'The target’s remote and keyboard'}
          </div>
        </div>
        <Button
          icon="photo_camera"
          loading={shot.busy}
          disabled={!shot.busy && shot.unavailable !== null}
          {...(shot.unavailable === null || shot.busy ? {} : { disabledReason: shot.unavailable })}
          onClick={() => void shot.take()}
        >
          {shot.busy ? 'Taking screenshot…' : 'Screenshot'}
        </Button>
      </header>
      {body}
    </div>
  )
}
