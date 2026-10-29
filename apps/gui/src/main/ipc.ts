import { app, ipcMain } from 'electron'
import type { Ovd } from '@ovd/core'
import type { DoctorReport } from '@ovd/core'
import { channels, type AppInfo, type IpcResult, type SdkSummary } from '../preload/api'
import { toResult } from './ipcResult'

// Core runs in-process in main (ADR 0004); each handler is a thin call into it.
export function registerIpcHandlers(ovd: Ovd): void {
  ipcMain.handle(channels.appInfo, (): AppInfo => ({
    version: app.getVersion(),
    // macOS and Ubuntu only (ADR 0013).
    platform: process.platform === 'darwin' ? 'darwin' : 'linux'
  }))

  ipcMain.handle(channels.sdkInfo, (): Promise<IpcResult<SdkSummary>> =>
    toResult(async () => ({ sdkVersion: (await ovd.sdk.get()).sdkVersion }))
  )

  ipcMain.handle(channels.doctorRun, (): Promise<IpcResult<DoctorReport>> =>
    toResult(() => ovd.doctor.run())
  )
}
