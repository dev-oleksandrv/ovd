import { ipcMain } from 'electron'
import type { Ovd } from '@ovd/core'
import { channels } from '../preload/api'
import { requireText } from './guards'
import { toResult } from './ipcResult'

// Wi‑Fi pairing, reconnect and forget (Stage 1.6, 1.7). After each one the device list is
// polled at once, so the new or forgotten device shows without waiting for the next tick.
export function registerPairingIpc(ovd: Ovd, refresh: () => Promise<unknown>): void {
  const thenRefresh = async <T>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action()
    } finally {
      await refresh()
    }
  }

  ipcMain.handle(channels.pairUsb, () => toResult(() => thenRefresh(() => ovd.pairing.pairUsb())))
  ipcMain.handle(channels.pairAddress, (_event, address: unknown) =>
    toResult(() => thenRefresh(() => ovd.pairing.pair(requireText(address, 'address'))))
  )
  ipcMain.handle(channels.connect, (_event, id: unknown) =>
    toResult(() => thenRefresh(() => ovd.pairing.connect(requireText(id, 'id'))))
  )
  ipcMain.handle(channels.forget, (_event, id: unknown) =>
    toResult(() => thenRefresh(() => ovd.pairing.forget(requireText(id, 'id'))))
  )
}
