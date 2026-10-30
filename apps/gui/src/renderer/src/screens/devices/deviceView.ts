import type { Device } from '@ovd/core'
import type { KeyValue } from '../../ui/KeyValueGrid'
import type { Tone } from '../../ui/tone'

// Labels and states as the design's Devices screen draws them (OVD Desktop v2).

// A Virtual Device start or stop this window is running; the device list catches up after.
export type VvdBusy = 'start' | 'stop' | null

export function statusView(
  device: Device,
  busy: VvdBusy = null
): {
  label: 'Online' | 'Offline' | 'Starting…' | 'Stopping…' | 'Stopped'
  tone: Tone
  pulse: boolean
} {
  if (device.kind === 'vvd' && busy === 'stop') {
    return { label: 'Stopping…', tone: 'warning', pulse: true }
  }
  if (device.kind === 'vvd' && busy === 'start') {
    return { label: 'Starting…', tone: 'warning', pulse: true }
  }
  switch (device.status) {
    case 'online':
      return { label: 'Online', tone: 'ok', pulse: false }
    case 'offline':
      return { label: 'Offline', tone: 'muted', pulse: false }
    case 'stopped':
      return { label: 'Stopped', tone: 'muted', pulse: false }
    case 'starting':
      return { label: 'Starting…', tone: 'warning', pulse: true }
  }
}

export function connectionLabel(device: Device): 'USB' | 'Wi-Fi' | 'Local' {
  return device.connection === 'usb' ? 'USB' : device.connection === 'wifi' ? 'Wi-Fi' : 'Local'
}

export function kindLabel(device: Device): 'Fire TV stick' | 'Vega Virtual Device' {
  return device.kind === 'vvd' ? 'Vega Virtual Device' : 'Fire TV stick'
}

export function subtitle(device: Device): string {
  return [connectionLabel(device), device.info?.architecture, device.info?.os]
    .filter((part) => part)
    .join(' · ')
}

// Online and not mid start or stop: the only state that can be a working target.
export function usable(device: Device, busy: VvdBusy = null): boolean {
  return device.status === 'online' && !(device.kind === 'vvd' && busy !== null)
}

export function dimmed(device: Device, busy: VvdBusy = null): boolean {
  if (device.kind === 'vvd' && busy !== null) return false
  return device.status === 'offline' || device.status === 'stopped'
}

export function infoRows(device: Device): KeyValue[] {
  const info = device.info
  const connection =
    connectionLabel(device) + (device.connection === 'wifi' && device.ip ? ` · ${device.ip}` : '')
  const rows: (KeyValue | null)[] = [
    info ? { label: 'OS', value: info.os } : null,
    info?.build ? { label: 'Build', value: info.build, mono: true } : null,
    info ? { label: 'Architecture', value: info.architecture, mono: true } : null,
    info ? { label: 'Profile', value: info.profile, mono: true } : null,
    { label: 'Connection', value: connection },
    device.serial ? { label: 'Serial', value: device.serial, mono: true } : null
  ]
  return rows.filter((row): row is KeyValue => row !== null)
}

// Over Wi‑Fi the ID is `IP:port`, so the detail also names the real serial. No command reads
// it over Wi‑Fi: it is the one OVD read over USB when it paired the stick.
export function serialLine(device: Device): string | null {
  return device.connection === 'wifi' && device.serial ? `Serial ${device.serial}` : null
}
