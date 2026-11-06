import { OvdError } from '../errors/ovdError.js'
import type { Devices } from './devices.js'
import type { Device } from './types.js'

// The target a device action runs on (`--device`, `VEGA_SERIAL` or the remembered one), which
// must be online: actions on apps and packages need a device that answers.
export async function onlineTarget(devices: Devices, override?: string): Promise<Device> {
  const resolved = await devices.currentTarget(override)
  if (!resolved) {
    throw new OvdError(
      'NO_TARGET',
      'No target device',
      'Set one with ovd target set <id>, or pass --device <id>'
    )
  }
  if (resolved.device.status !== 'online') throw offline(resolved.device)
  return resolved.device
}

export function offline(device: Device): OvdError {
  return new OvdError(
    'TARGET_OFFLINE',
    `${device.name} is ${device.status === 'stopped' ? 'stopped' : 'offline'}`,
    device.kind === 'vvd'
      ? 'Start it with ovd vvd start'
      : 'Reconnect it, then check with ovd devices'
  )
}
