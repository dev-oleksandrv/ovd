import type { DeviceInfo } from '../adapters/parseDeviceInfo.js'

export type DeviceKind = 'stick' | 'vvd'
export type Connection = 'usb' | 'wifi' | 'local'
export type DeviceStatus = 'online' | 'offline' | 'stopped' | 'starting'

export interface Device {
  // Canonical ID: USB serial, `IP:port` over Wi‑Fi, or `VirtualDevice`.
  id: string
  // The ID VDA uses (`emulator-5554` for the Virtual Device); present while VDA lists it.
  vdaSerial?: string
  // The real serial, the key for names. `VirtualDevice` for the Virtual Device.
  serial?: string
  name: string
  kind: DeviceKind
  connection: Connection
  ip?: string
  status: DeviceStatus
  isTarget: boolean
  // A remembered Wi‑Fi device.
  saved: boolean
  // Present when the device is online and `vega device info` could read it.
  info?: DeviceInfo
}

export interface DevicesSnapshot {
  devices: Device[]
  target: string | null
}

export type TargetSource = 'flag' | 'env' | 'remembered' | 'only-online'

export interface ResolvedTarget {
  device: Device
  source: TargetSource
}
