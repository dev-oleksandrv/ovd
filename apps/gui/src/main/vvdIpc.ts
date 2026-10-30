import { app, ipcMain } from 'electron'
import type { Ovd } from '@ovd/core'
import { channels } from '../preload/api'
import { toResult } from './ipcResult'

// Virtual Device actions (Stage 1.4). After each one the device list is polled at once, so
// every screen sees the new state without waiting for the next 2 s tick.
export function registerVvdIpc(ovd: Ovd, refresh: () => Promise<unknown>): void {
  // Quitting stops a start in progress rather than leaving `vega virtual-device start` behind.
  const quitting = new AbortController()
  app.on('before-quit', () => quitting.abort())

  const thenRefresh = async <T>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action()
    } finally {
      await refresh()
    }
  }

  ipcMain.handle(channels.vvdStart, () =>
    toResult(() => thenRefresh(() => ovd.vvd.start({ signal: quitting.signal })))
  )
  ipcMain.handle(channels.vvdStop, () => toResult(() => thenRefresh(() => ovd.vvd.stop())))
  ipcMain.handle(channels.vvdDevmodeEnable, () =>
    toResult(() => thenRefresh(() => ovd.vvd.enableDeveloperMode()))
  )
}
