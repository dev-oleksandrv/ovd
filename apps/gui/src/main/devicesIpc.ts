import { ipcMain, type BrowserWindow } from 'electron'
import { createDevicesWatcher, type Ovd } from '@ovd/core'
import { channels } from '../preload/api'
import { requireText } from './guards'
import { toResult } from './ipcResult'

// Main owns device state (gui rules): it polls while the window is visible and pushes changes.
export function registerDevicesIpc(
  ovd: Ovd,
  window: () => BrowserWindow | undefined
): {
  watch(win: BrowserWindow): void
  // Polls now and pushes the result, after an action that changed the devices.
  refresh(): Promise<unknown>
} {
  const watcher = createDevicesWatcher({
    list: () => ovd.devices.list(),
    onUpdate: (update) => window()?.webContents.send(channels.devicesChanged, update)
  })

  ipcMain.handle(channels.devicesList, () => watcher.refresh())

  ipcMain.handle(channels.devicesRename, async (_event, id: unknown, name: unknown) => {
    const result = await toResult(() =>
      ovd.devices.rename(requireText(id, 'id'), requireText(name, 'name'))
    )
    await watcher.refresh()
    return result
  })

  ipcMain.handle(channels.targetSet, async (_event, id: unknown) => {
    const result = await toResult(() => ovd.devices.setTarget(requireText(id, 'id')))
    await watcher.refresh()
    return result
  })

  return {
    refresh: () => watcher.refresh(),
    watch(win) {
      const sync = (): void => {
        if (win.isVisible() && !win.isMinimized()) watcher.start()
        else watcher.stop()
      }
      win.on('show', sync)
      win.on('hide', sync)
      win.on('minimize', sync)
      win.on('restore', sync)
      win.on('closed', () => watcher.stop())
      sync()
    }
  }
}
