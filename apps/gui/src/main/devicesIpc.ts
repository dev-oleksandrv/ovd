import { ipcMain, type BrowserWindow } from 'electron'
import { createDevicesWatcher, isOvdError, toErrorJson, type Ovd } from '@ovd/core'
import { channels, type IpcResult } from '../preload/api'
import { requireText } from './guards'

async function toResult<T>(action: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await action() }
  } catch (error) {
    if (isOvdError(error)) return { ok: false, error: toErrorJson(error) }
    throw error
  }
}

// Main owns device state (gui rules): it polls while the window is visible and pushes changes.
export function registerDevicesIpc(
  ovd: Ovd,
  window: () => BrowserWindow | undefined
): {
  watch(win: BrowserWindow): void
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
