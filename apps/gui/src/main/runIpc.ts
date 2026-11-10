import { ipcMain, type BrowserWindow } from 'electron'
import type { Ovd } from '@ovd/core'
import { channels } from '../preload/api'
import { createRunHandler, type RunHandler, type RunHandlerDeps } from './runHandler'

// `ovd:run` and its progress pushes (`runHandler.ts`). Returns the handler, whose one-run lock
// Watch's redeploys share.
export function registerRunIpc(
  ovd: Ovd,
  logs: RunHandlerDeps['logs'],
  window: () => BrowserWindow | undefined
): RunHandler {
  const handler = createRunHandler({
    run: ovd.run,
    logs,
    send: (progress) => {
      const win = window()
      if (win && !win.isDestroyed()) win.webContents.send(channels.runProgress, progress)
    }
  })
  ipcMain.handle(channels.run, (_event, device: unknown) => handler.run(device))
  return handler
}
