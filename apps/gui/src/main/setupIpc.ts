import { app, ipcMain, type BrowserWindow } from 'electron'
import { OvdError, type Ovd } from '@ovd/core'
import { channels } from '../preload/api'
import { requireText } from './guards'
import { toResult } from './ipcResult'

// The new-stick wizard (Stage 1.5). A sign-in or wait in progress stops when the wizard
// closes (cancel) or the app quits, so no `vega devmode login` is left behind.
export function registerSetupIpc(
  ovd: Ovd,
  window: () => BrowserWindow | undefined,
  refresh: () => Promise<unknown>
): void {
  let running: AbortController | null = null
  app.on('before-quit', () => running?.abort())

  // One sign-in or wait at a time: a new one replaces the last.
  async function abortable<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    running?.abort()
    const controller = new AbortController()
    running = controller
    try {
      return await action(controller.signal)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new OvdError('COMMAND_FAILED', 'Cancelled', 'Start the setup again')
      }
      throw error
    } finally {
      if (running === controller) running = null
    }
  }

  ipcMain.handle(channels.setupSignedIn, () => toResult(() => ovd.devmode.signedIn()))
  ipcMain.handle(channels.setupLogin, () =>
    toResult(() =>
      abortable((signal) =>
        ovd.devmode.login({
          signal,
          onPrompt: (prompt) => window()?.webContents.send(channels.setupLoginPrompt, prompt)
        })
      )
    )
  )
  ipcMain.handle(channels.setupEnable, (_event, code: unknown, vendor: unknown) =>
    toResult(() =>
      ovd.devmode.enableDevice({
        code: requireText(code, 'code'),
        ...(vendor === undefined || vendor === '' ? {} : { vendor: requireText(vendor, 'vendor') })
      })
    )
  )
  ipcMain.handle(channels.setupWait, () =>
    toResult(async () => {
      try {
        return await abortable((signal) => ovd.devmode.waitForStick({ signal }))
      } finally {
        // The stick shows in Devices at once, not on the next tick.
        await refresh()
      }
    })
  )
  ipcMain.handle(channels.setupCancel, () => {
    running?.abort()
  })
}
