import type { Device } from '@ovd/core'
import { useCallback, useMemo, type ReactNode } from 'react'
import { useFeedback } from '../feedback/feedbackContext'
import { DevicesContext, type DevicesValue } from './devicesContext'
import { useDevices } from './useDevices'

// One device subscription for the whole window: the title bar, status bar, palette and
// Devices screen all read the same snapshot.
export function DevicesProvider({ children }: { children: ReactNode }) {
  const { state, rescan } = useDevices()
  const { notify } = useFeedback()

  const setTarget = useCallback(
    async (device: Device): Promise<void> => {
      const cli = `ovd target set ${device.id}`
      const result = await window.ovd.devices.setTarget(device.id)
      if (result.ok) notify({ tone: 'info', text: `Target: ${result.data.name}`, cli })
      else notify({ tone: 'error', text: result.error.message, cli })
    },
    [notify]
  )

  const value = useMemo<DevicesValue>(
    () => ({ state, rescan, setTarget }),
    [state, rescan, setTarget]
  )
  return <DevicesContext.Provider value={value}>{children}</DevicesContext.Provider>
}
