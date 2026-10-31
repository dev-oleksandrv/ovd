import { dialog, ipcMain, type BrowserWindow, type OpenDialogOptions } from 'electron'
import type { Ovd } from '@ovd/core'
import { channels } from '../preload/api'
import { requireText } from './guards'
import { toResult } from './ipcResult'

// Project card and no-project mode (Stage 2.1). Pickers run here so the renderer never sees
// the file system; a dropped file's path comes from the preload's `webUtils`.
export function registerProjectIpc(ovd: Ovd, window: () => BrowserWindow | undefined): void {
  const pick = async (options: OpenDialogOptions) => {
    const win = window()
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    const [path] = result.filePaths
    return result.canceled || path === undefined ? null : ovd.project.open(path)
  }

  ipcMain.handle(channels.projectCurrent, () => toResult(() => ovd.project.current()))
  ipcMain.handle(channels.projectOpen, (_event, path: unknown) =>
    toResult(() => ovd.project.open(requireText(path, 'path')))
  )
  ipcMain.handle(channels.projectPickFolder, () =>
    toResult(() => pick({ title: 'Open a project folder', properties: ['openDirectory'] }))
  )
  ipcMain.handle(channels.projectPickVpkg, () =>
    toResult(() =>
      pick({
        title: 'Open a .vpkg',
        properties: ['openFile'],
        filters: [{ name: 'Vega package', extensions: ['vpkg'] }]
      })
    )
  )
}
