import { ipcMain, type BrowserWindow } from 'electron'
import type { Ovd } from '@ovd/core'
import { channels } from '../preload/api'
import type { LogsController } from './logsController'
import type { RunHandler } from './runHandler'
import { createWatchController, type WatchController } from './watchController'

// `ovd:watch:set`, `ovd:watch:state` and the watch's pushes (`watchController.ts`).
export function registerWatchIpc(
  ovd: Ovd,
  run: RunHandler,
  logs: WatchControllerLogs,
  window: () => BrowserWindow | undefined
): WatchController {
  const controller = createWatchController({
    watch: ovd.watch,
    redeploy: run.redeploy,
    logs,
    target: async () => (await ovd.devices.currentTarget())?.device.id ?? null,
    send: (event) => {
      const win = window()
      if (win && !win.isDestroyed()) win.webContents.send(channels.watchEvent, event)
    }
  })
  ipcMain.handle(channels.watchSet, (_event, on: unknown) => controller.set(on))
  ipcMain.handle(channels.watchState, () => controller.state())
  return controller
}

type WatchControllerLogs = Pick<LogsController, 'open' | 'running' | 'device'>
