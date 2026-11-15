import { dialog, ipcMain, type BrowserWindow } from 'electron'
import type { Ovd } from '@ovd/core'
import { channels } from '../preload/api'
import { requireText } from './guards'
import { toResult } from './ipcResult'

// Packages → Overview (Stage 2.2) and Manifest, Files, Validate (5.3). The picker runs here so the renderer never sees the file
// system; a dropped file's path comes from the preload's `webUtils`.
export function registerPackagesIpc(ovd: Ovd, window: () => BrowserWindow | undefined): void {
  ipcMain.handle(channels.packagesInfo, (_event, path: unknown) =>
    toResult(() => ovd.packages.info(requireText(path, 'path')))
  )
  ipcMain.handle(channels.packagesBuilds, () => toResult(() => ovd.packages.builds()))
  // Stage 5.3 tabs: the path is checked here and again in core (an existing .vpkg file).
  ipcMain.handle(channels.packagesManifest, (_event, path: unknown) =>
    toResult(() => ovd.packages.manifestFile(requireText(path, 'path')))
  )
  ipcMain.handle(channels.packagesFiles, (_event, path: unknown) =>
    toResult(() => ovd.packages.files(requireText(path, 'path')))
  )
  ipcMain.handle(channels.packagesValidate, (_event, path: unknown) =>
    toResult(() => ovd.packages.validate(requireText(path, 'path')))
  )
  ipcMain.handle(channels.packagesPick, () =>
    toResult(async () => {
      const win = window()
      const options = {
        title: 'Inspect a .vpkg',
        properties: ['openFile' as const],
        filters: [{ name: 'Vega package', extensions: ['vpkg'] }]
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      const [path] = result.filePaths
      return result.canceled || path === undefined ? null : path
    })
  )
}
