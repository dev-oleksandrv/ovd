import type { VdaEntry } from '../adapters/parseVdaDevices.js'
import type { Connection, DeviceKind } from './types.js'

export const VVD_ID = 'VirtualDevice'
const EMULATOR = /^emulator-\d+$/
const HOST_PORT = /^(.+):(\d+)$/

// VDA calls the Virtual Device `emulator-5554`; `vega device` and OVD call it `VirtualDevice`.
export function canonicalId(id: string): string {
  return EMULATOR.test(id) ? VVD_ID : id
}

export function classifyVdaEntry(entry: VdaEntry): {
  id: string
  kind: DeviceKind
  connection: Connection
  ip?: string
} {
  if (EMULATOR.test(entry.vdaSerial)) return { id: VVD_ID, kind: 'vvd', connection: 'local' }
  const wifi = entry.props.usb === undefined ? HOST_PORT.exec(entry.vdaSerial) : null
  if (wifi?.[1]) {
    return { id: entry.vdaSerial, kind: 'stick', connection: 'wifi', ip: wifi[1] }
  }
  return { id: entry.vdaSerial, kind: 'stick', connection: 'usb' }
}

// No SDK command reports a friendly name, so OVD gives one (spec D1).
export function defaultName(kind: DeviceKind, serial: string, stickSerials: string[]): string {
  if (kind === 'vvd') return 'Vega Virtual Device'
  return new Set(stickSerials).size > 1 ? `Fire TV stick ${serial.slice(-4)}` : 'Fire TV stick'
}
