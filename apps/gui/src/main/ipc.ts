import { app, ipcMain } from 'electron'
import { channels, type AppInfo } from '../preload/api'

// Core runs in-process in main (ADR 0004); each handler is a thin call into it.
export function registerIpcHandlers(): void {
  ipcMain.handle(channels.appInfo, (): AppInfo => ({
    version: app.getVersion(),
    // macOS and Ubuntu only (ADR 0013).
    platform: process.platform === 'darwin' ? 'darwin' : 'linux'
  }))
}
