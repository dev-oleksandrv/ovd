import type { Device, DevicesUpdate } from '@ovd/core'
import { createContext, useContext } from 'react'
import type { DevicesState } from './useDevices'
import type { VvdActions } from './useVvdActions'

export interface DevicesValue {
  state: DevicesState
  rescan: () => Promise<DevicesUpdate>
  // Sets the target and reports it (toast + CLI echo); the picker, palette and detail share it.
  setTarget: (device: Device) => Promise<void>
  vvd: VvdActions
}

export const DevicesContext = createContext<DevicesValue | null>(null)

export function useDevicesContext(): DevicesValue {
  const value = useContext(DevicesContext)
  if (!value) throw new Error('useDevicesContext must be used inside <DevicesProvider>')
  return value
}

// The device the snapshot names as target, if it is in the list.
export function targetDevice(state: DevicesState): Device | undefined {
  return state.status === 'ready' ? state.devices.find((d) => d.id === state.target) : undefined
}
