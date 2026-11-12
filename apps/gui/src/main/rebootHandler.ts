import type { Ovd, RebootResult } from '@ovd/core'
import type { IpcResult } from '../preload/api'
import { requireText } from './guards'
import type { InputController } from './inputController'
import { toResult } from './ipcResult'
import type { ScreenController } from './screenController'

export interface RebootHandlerDeps {
  reboot: Pick<Ovd['reboot'], 'reboot'>
  input: Pick<InputController, 'deviceRebooting' | 'deviceBack'>
  screen: Pick<ScreenController, 'deviceBack'>
  // Polls the device list now, so every screen sees the device back without the next 2 s tick.
  refresh: () => Promise<unknown>
  // Aborted on quit: the wait stops, the reboot itself goes on.
  signal: AbortSignal
}

// Devices → Reboot & wait (Stage 4.5): what `ovd reboot --device <id>` runs. The Remote's
// session on the device closes first (a stick's console would die with the reboot) and reopens
// once the wait ends, back or not; a live view showing no signal opens its stream again.
export function createRebootHandler(
  deps: RebootHandlerDeps
): (id: unknown) => Promise<IpcResult<RebootResult>> {
  return async (value) => {
    const device = requireText(value, 'id')
    await deps.input.deviceRebooting(device)
    try {
      return await toResult(() => deps.reboot.reboot({ device, signal: deps.signal }))
    } finally {
      deps.input.deviceBack(device)
      deps.screen.deviceBack(device)
      await deps.refresh().catch(() => undefined)
    }
  }
}
