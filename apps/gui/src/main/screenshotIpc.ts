import { copyFile, readFile } from 'node:fs/promises'
import { clipboard, ClipboardItem, ipcMain, nativeImage, shell, type BrowserWindow } from 'electron'
import type { Ovd } from '@ovd/core'
import { channels, type IpcResult } from '../preload/api'
import { createScreenshotController } from './screenshotController'

// Electron's clipboard (Electron 44's `clipboard.write` with an `image/png` item; it has no
// `writeImage` any more), unless `OVD_CLIPBOARD_FILE` is set: a testing hook (as the
// `OVD_EMULATOR_*` overrides are) that copies the PNG to that file instead, so e2e never
// touches the real clipboard.
async function copyImage(path: string): Promise<boolean> {
  const file = process.env.OVD_CLIPBOARD_FILE
  if (file) {
    await copyFile(path, file)
    return true
  }
  // An image Electron can't read isn't copied.
  if (nativeImage.createFromPath(path).isEmpty()) return false
  const png = new Blob([await readFile(path)], { type: 'image/png' })
  await clipboard.write([new ClipboardItem({ 'image/png': png })])
  return true
}

export function registerScreenshotIpc(ovd: Ovd, window: () => BrowserWindow | undefined): void {
  const controller = createScreenshotController({
    screenshot: ovd.screenshot,
    copyImage,
    send: (list) => {
      const win = window()
      if (win && !win.isDestroyed()) win.webContents.send(channels.screenshotCapturesUpdate, list)
    }
  })
  ipcMain.handle(channels.screenshotTake, (_event, device: unknown) => controller.take(device))
  ipcMain.handle(channels.screenshotCaptures, () => controller.captures())
  ipcMain.handle(
    channels.screenshotReveal,
    async (_event, path: unknown): Promise<IpcResult<null>> => {
      let real: string
      try {
        real = await controller.revealable(path)
      } catch (error) {
        // An invalid payload stays a thrown error; a capture removed meanwhile is data.
        if (error instanceof TypeError) throw error
        return {
          ok: false,
          error: {
            code: 'PATH_NOT_FOUND',
            message: 'That screenshot is gone',
            hint: 'Take another one, or open the folder'
          }
        }
      }
      shell.showItemInFolder(real)
      return { ok: true, data: null }
    }
  )
  ipcMain.handle(channels.screenshotOpenFolder, async (): Promise<IpcResult<null>> => {
    const dir = await controller.folder()
    const failed = await shell.openPath(dir)
    return failed
      ? {
          ok: false,
          error: { code: 'PATH_NOT_FOUND', message: failed, hint: `Open ${dir} yourself` }
        }
      : { ok: true, data: null }
  })
}
