import type { Device, DevicesUpdate, ErrorJson } from '@ovd/core'
import { useCallback, useEffect, useState } from 'react'

export type DevicesState =
  | { status: 'loading' }
  | { status: 'ready'; devices: Device[]; target: string | null }
  | { status: 'error'; error: ErrorJson }

function toState(update: DevicesUpdate): DevicesState {
  return update.ok
    ? { status: 'ready', devices: update.devices, target: update.target }
    : { status: 'error', error: update.error }
}

// The device list as main's watcher sees it: one poll on mount, then every pushed change.
export function useDevices(): { state: DevicesState; rescan: () => Promise<DevicesUpdate> } {
  const [state, setState] = useState<DevicesState>({ status: 'loading' })

  useEffect(() => {
    let live = true
    const unsubscribe = window.ovd.devices.onChange((update) => setState(toState(update)))
    void window.ovd.devices.list().then((update) => {
      if (live) setState(toState(update))
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [])

  const rescan = useCallback(async () => {
    const update = await window.ovd.devices.list()
    setState(toState(update))
    return update
  }, [])

  return { state, rescan }
}
