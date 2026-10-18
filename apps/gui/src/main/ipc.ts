import { ipcMain } from 'electron'
import { hello } from '@ovd/core'
import { channels } from '../preload/api'

// Core runs in-process in main (ADR 0004); each handler is a thin call into it.
export function registerIpcHandlers(): void {
  ipcMain.handle(channels.hello, () => hello())
}
