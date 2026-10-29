import type { Device } from '@ovd/core'
import type { KeyValue } from '../../ui/KeyValueGrid'
import type { Tone } from '../../ui/tone'

// Labels and states as the design's Devices screen draws them (OVD Desktop v2).

export function statusView(device: Device): {
  label: 'Online' | 'Offline' | 'Starting…' | 'Stopped'
  tone: Tone
  pulse: boolean
} {
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

export function dimmed(device: Device): boolean {
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

// Over Wi‑Fi the ID is `IP:port`, so the detail also names the real serial and its source.
export function serialLine(device: Device): string | null {
  return device.connection === 'wifi' && device.serial
    ? `Serial ${device.serial} · vda get-serialno`
    : null
}
