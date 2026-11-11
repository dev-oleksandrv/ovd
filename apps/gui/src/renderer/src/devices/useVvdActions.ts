import type { VvdState } from '@ovd/core'
import { useRef, useState } from 'react'
import type { IpcResult } from '../../../preload/api'
import { useFeedback } from '../feedback/feedbackContext'
import type { VvdBusy } from '../screens/devices/deviceView'

export interface VvdActions {
  busy: VvdBusy
  // Turning on Developer Mode on the Virtual Device.
  enabling: boolean
  // Turning on emulator gRPC (Doctor's Turn on); apart from `busy`, so Start doesn't change.
  grpcBusy: boolean
  // Resolve with whether the action worked; failures are already toasted with Retry.
  start(): Promise<boolean>
  stop(): Promise<boolean>
  enableDeveloperMode(): Promise<boolean>
  // Runs the start again, which turns gRPC on (`ovd vvd start`); true only when it is on.
  enableGrpc(): Promise<boolean>
}

const START_CLI = 'ovd vvd start'
const STOP_CLI = 'ovd vvd stop'
const DEVMODE_CLI = 'ovd vvd devmode enable'

// Virtual Device start, stop and Developer Mode, shared by the device detail, the Devices
// empty state, first run, Doctor and the palette. Copy from the design (`toggleVvd`,
// `enableDevMode`).
export function useVvdActions(): VvdActions {
  const { notify, echo } = useFeedback()
  const [busy, setBusy] = useState<VvdBusy>(null)
  const [enabling, setEnabling] = useState(false)
  // State updates land after a render; a ref stops a second click in the same tick.
  const running = useRef<VvdBusy>(null)
  const enablingRef = useRef(false)
  const [grpcBusy, setGrpcBusy] = useState(false)
  const grpcRef = useRef(false)

  async function power(kind: 'start' | 'stop'): Promise<boolean> {
    if (running.current) return false
    running.current = kind
    setBusy(kind)
    const cli = kind === 'start' ? START_CLI : STOP_CLI
    echo(cli)
    let result: IpcResult<VvdState>
    let grpcHint: string | null = null
    if (kind === 'start') {
      const startResult = await window.ovd.vvd.start()
      if (startResult.ok && startResult.data.grpc.status === 'failed') {
        grpcHint = startResult.data.grpc.error.hint
      }
      result = startResult
    } else {
      result = await window.ovd.vvd.stop()
    }
    running.current = null
    setBusy(null)
    if (result.ok) {
      // The device started either way; without gRPC, keys and screenshots won't work yet.
      if (grpcHint !== null) {
        notify({
          tone: 'warning',
          text: `Virtual Device started, but emulator gRPC couldn’t be turned on. ${sentence(grpcHint)}`,
          cli
        })
        return true
      }
      notify(
        kind === 'start'
          ? { tone: 'ok', text: 'Virtual Device started', cli }
          : { tone: 'info', text: 'Virtual Device stopped', cli }
      )
      return true
    }
    notify({
      tone: 'error',
      text: `Virtual Device didn’t ${kind}. Run ${cli} in a terminal to see why.`,
      cli,
      action: { label: 'Retry', run: () => void power(kind) }
    })
    return false
  }

  async function enableDeveloperMode(): Promise<boolean> {
    if (enablingRef.current) return false
    enablingRef.current = true
    setEnabling(true)
    echo(DEVMODE_CLI)
    const result = await window.ovd.vvd.enableDeveloperMode()
    enablingRef.current = false
    setEnabling(false)
    if (result.ok) {
      notify({ tone: 'ok', text: 'Developer Mode on', cli: DEVMODE_CLI })
      return true
    }
    notify({
      tone: 'error',
      text: 'Developer Mode didn’t turn on. Try again; if it keeps failing, restart the Virtual Device.',
      cli: DEVMODE_CLI,
      action: { label: 'Retry', run: () => void enableDeveloperMode() }
    })
    return false
  }

  async function enableGrpc(): Promise<boolean> {
    if (grpcRef.current) return false
    grpcRef.current = true
    setGrpcBusy(true)
    echo(START_CLI)
    const result = await window.ovd.vvd.start()
    grpcRef.current = false
    setGrpcBusy(false)
    if (result.ok && result.data.grpc.status === 'on') {
      notify({ tone: 'ok', text: 'Emulator gRPC on', cli: START_CLI })
      return true
    }
    const hint = result.ok
      ? result.data.grpc.status === 'failed'
        ? result.data.grpc.error.hint
        : ''
      : result.error.hint
    notify({
      tone: 'error',
      text: `Emulator gRPC couldn’t be turned on.${hint ? ` ${sentence(hint)}` : ''}`,
      cli: START_CLI,
      action: { label: 'Retry', run: () => void enableGrpc() }
    })
    return false
  }

  return {
    busy,
    enabling,
    grpcBusy,
    enableGrpc,
    start: () => power('start'),
    stop: () => power('stop'),
    enableDeveloperMode
  }
}

// Core's hints are bare clauses; a toast reads them as a sentence.
function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`
}
