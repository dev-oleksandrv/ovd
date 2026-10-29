import type { Device } from '@ovd/core'

export const stick: Device = {
  id: 'G070000000000001',
  vdaSerial: 'G070000000000001',
  serial: 'G070000000000001',
  name: 'Fire TV stick',
  kind: 'stick',
  connection: 'usb',
  status: 'online',
  isTarget: true,
  saved: false,
  info: {
    os: 'OS 2.0',
    build: 'TV Ship/529',
    architecture: 'armv7',
    profile: 'tv',
    product: 'callie',
    simulated: false,
    developerMode: true,
    raw: { os: 'OS', architecture: 'armv7l' }
  }
}

export const vvd: Device = {
  id: 'VirtualDevice',
  serial: 'VirtualDevice',
  name: 'Vega Virtual Device',
  kind: 'vvd',
  connection: 'local',
  status: 'stopped',
  isTarget: false,
  saved: false
}

export const wifiOffline: Device = {
  id: '192.0.2.77:5555',
  serial: 'G070000000000002',
  name: 'Bedroom stick',
  kind: 'stick',
  connection: 'wifi',
  ip: '192.0.2.77',
  status: 'offline',
  isTarget: false,
  saved: true
}
