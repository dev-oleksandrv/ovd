import { app, ipcMain } from 'electron'
import type { Ovd } from '@ovd/core'
import { channels } from '../preload/api'
import type { InputController } from './inputController'
import { createRebootHandler } from './rebootHandler'
import type { ScreenController } from './screenController'

// Devices → Reboot & wait (Stage 4.5). Registered once the input session and the live view exist.
export function registerRebootIpc(
  ovd: Ovd,
  deps: { input: InputController; screen: ScreenController; refresh: () => Promise<unknown> }
): void {
  // Quitting stops the wait rather than holding the serial runner with polls.
  const quitting = new AbortController()
  app.on('before-quit', () => quitting.abort())
  const reboot = createRebootHandler({ reboot: ovd.reboot, ...deps, signal: quitting.signal })
  ipcMain.handle(channels.devicesReboot, (_event, id: unknown) => reboot(id))
}
