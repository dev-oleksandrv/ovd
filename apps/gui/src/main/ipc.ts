import { app, ipcMain } from 'electron'
import type { Ovd } from '@ovd/core'
import type { DoctorReport } from '@ovd/core'
import { channels, type AppInfo, type IpcResult, type SdkSummary } from '../preload/api'
import { toResult } from './ipcResult'

// Core runs in-process in main (ADR 0004); each handler is a thin call into it.
export function registerIpcHandlers(ovd: Ovd, quitting: AbortSignal): void {
  ipcMain.handle(channels.appInfo, (): AppInfo => ({ version: app.getVersion() }))

  ipcMain.handle(channels.sdkInfo, (): Promise<IpcResult<SdkSummary>> =>
    toResult(async () => ({ sdkVersion: (await ovd.sdk.get()).sdkVersion }))
  )

  ipcMain.handle(channels.doctorRun, (): Promise<IpcResult<DoctorReport>> =>
    // Quitting stops the sign-in probe in flight instead of leaving `vega devmode login`
    // behind. The AbortError then is not mapped: no window is left to show it.
    toResult(() => ovd.doctor.run({ signal: quitting }))
  )
}
