import { ipcMain, type BrowserWindow } from 'electron'
import type { Ovd } from '@ovd/core'
import { channels } from '../preload/api'
import { createRunHandler, type RunHandlerDeps } from './runHandler'

// `ovd:run` and its progress pushes (`runHandler.ts`).
export function registerRunIpc(
  ovd: Ovd,
  logs: RunHandlerDeps['logs'],
  window: () => BrowserWindow | undefined
): void {
  const handle = createRunHandler({
    run: ovd.run,
    logs,
    send: (progress) => {
      const win = window()
      if (win && !win.isDestroyed()) win.webContents.send(channels.runProgress, progress)
    }
  })
  ipcMain.handle(channels.run, (_event, device: unknown) => handle(device))
}
