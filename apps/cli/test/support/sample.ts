import {
  OvdError,
  type Device,
  type Devices,
  type ErrorCode,
  type Ovd,
  type Pairing,
  type Vvd
} from '@ovd/core'

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
    raw: { architecture: 'armv7l' }
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

export const wifiStick: Device = {
  ...stick,
  id: '192.0.2.42:5555',
  vdaSerial: '192.0.2.42:5555',
  connection: 'wifi',
  ip: '192.0.2.42',
  saved: true
}

export const fail = (code: ErrorCode) => () =>
  Promise.reject(new OvdError(code, `failed: ${code}`, `hint for ${code}`))

// A core whose device calls are scripted per test; unscripted calls fail loudly.
export function stubOvd(devices: Partial<Devices>): Partial<Ovd> {
  const missing = (name: string) => () => Promise.reject(new Error(`unexpected ${name}`))
  return {
    devices: {
      list: missing('list'),
      currentTarget: missing('currentTarget'),
      get: missing('get'),
      rename: missing('rename'),
      setTarget: missing('setTarget'),
      invalidate: () => undefined,
      ...devices
    }
  }
}

// A core whose Virtual Device calls are scripted per test.
export function stubVvd(vvd: Partial<Vvd>): Partial<Ovd> {
  const missing = (name: string) => () => Promise.reject(new Error(`unexpected ${name}`))
  return {
    vvd: {
      status: missing('status'),
      start: missing('start'),
      stop: missing('stop'),
      developerMode: missing('developerMode'),
      enableDeveloperMode: missing('enableDeveloperMode'),
      ...vvd
    }
  }
}

// A core whose pairing calls are scripted per test.
export function stubPairing(pairing: Partial<Pairing>): Partial<Ovd> {
  const missing = (name: string) => () => Promise.reject(new Error(`unexpected ${name}`))
  return {
    pairing: {
      pairUsb: missing('pairUsb'),
      pair: missing('pair'),
      connect: missing('connect'),
      forget: missing('forget'),
      reconnectSaved: missing('reconnectSaved'),
      ...pairing
    }
  }
}
