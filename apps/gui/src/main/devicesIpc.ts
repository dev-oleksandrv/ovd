import { ipcMain, type BrowserWindow } from 'electron'
import { createDevicesWatcher, type DevicesUpdate, type Ovd } from '@ovd/core'
import { channels } from '../preload/api'
import { requireText } from './guards'
import { toResult } from './ipcResult'

// Main owns device state (gui rules): it polls while the window is visible and pushes changes.
// `onUpdate` hears of every change first, so main's log session follows a target change (from
// the target menu, or one made in a terminal and picked up by a poll) before the renderer does.
export function registerDevicesIpc(
  ovd: Ovd,
  window: () => BrowserWindow | undefined,
  onUpdate?: (update: DevicesUpdate) => void
): {
  watch(win: BrowserWindow): void
  // Polls now and pushes the result, after an action that changed the devices.
  refresh(): Promise<unknown>
} {
  const watcher = createDevicesWatcher({
    list: () => ovd.devices.list(),
    onUpdate: (update) => {
      onUpdate?.(update)
      window()?.webContents.send(channels.devicesChanged, update)
    }
  })

  // Launch and every Rescan first reconnect saved Wi‑Fi devices VDA has lost (spec C5). A
  // failure there shows up in the list itself: offline, or the SDK error.
  const reconnect = (): Promise<void> => ovd.pairing.reconnectSaved().catch(() => undefined)
  // The launch reconnect runs once, before the first poll and the renderer's first list: a
  // list shown while it still runs could change under the user (a device lost meanwhile
  // would come back without Reconnect).
  const launched = reconnect()
  let ready = false
  let firstList = true

  ipcMain.handle(channels.devicesList, async () => {
    if (firstList) {
      firstList = false
      await launched
    } else {
      await reconnect()
    }
    return watcher.refresh()
  })

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
        if (ready && win.isVisible() && !win.isMinimized()) watcher.start()
        else watcher.stop()
      }
      void launched.then(() => {
        ready = true
        if (!win.isDestroyed()) sync()
      })
      win.on('show', sync)
      win.on('hide', sync)
      win.on('minimize', sync)
      win.on('restore', sync)
      win.on('closed', () => watcher.stop())
      sync()
    }
  }
}
