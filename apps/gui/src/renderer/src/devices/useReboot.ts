import type { Device, RebootResult } from '@ovd/core'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { IpcResult } from '../../../preload/api'
import { useFeedback } from '../feedback/feedbackContext'

export interface RebootActions {
  // The ID of the device being rebooted, while OVD waits for it.
  rebooting: string | null
  // Resolves with whether the device came back; failures are already toasted with Retry.
  reboot(device: Device): Promise<boolean>
}

export function rebootCli(device: Device): string {
  return `ovd reboot --device ${device.id}`
}

// Devices → Reboot & wait (Stage 4.5): one reboot at a time for the window. The echo goes out
// when it starts, the toast when the device is back or the wait failed.
export function useReboot(): RebootActions {
  const { notify, echo } = useFeedback()
  const [rebooting, setRebooting] = useState<string | null>(null)
  // State updates land after a render; a ref stops a second click in the same tick.
  const running = useRef(false)

  const reboot = useCallback(
    async (device: Device): Promise<boolean> => {
      if (running.current) return false
      running.current = true
      setRebooting(device.id)
      const cli = rebootCli(device)
      echo(cli)
      const retry = { label: 'Retry', run: () => void reboot(device) }
      let result: IpcResult<RebootResult>
      try {
        result = await window.ovd.devices.reboot(device.id)
      } catch {
        // The IPC call rejects on a non-OVD error (an abort on quit, a malformed reply); the
        // window must not stay stuck on Rebooting….
        notify({
          tone: 'error',
          text: `${device.name} didn’t reboot. Run ${cli} in a terminal to see why.`,
          cli,
          action: retry
        })
        return false
      } finally {
        running.current = false
        setRebooting(null)
      }
      if (result.ok) {
        notify({
          tone: 'ok',
          text: `${result.data.target.name} is back online · ${result.data.seconds} s`,
          cli
        })
        return true
      }
      notify({
        tone: 'error',
        text: `${result.error.message}. ${result.error.hint}`,
        cli,
        action: retry
      })
      return false
    },
    [echo, notify]
  )

  return useMemo(() => ({ rebooting, reboot }), [rebooting, reboot])
}
