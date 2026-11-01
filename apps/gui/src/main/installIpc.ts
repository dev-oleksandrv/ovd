import { ipcMain } from 'electron'
import type { Ovd } from '@ovd/core'
import { channels } from '../preload/api'
import { requireText } from './guards'
import { toResult } from './ipcResult'

// Install behind the architecture guard (Stage 2.3, ADR 0008). The renderer names the device
// it shows as target, so the guard and the install see the same one.
export function registerInstallIpc(ovd: Ovd): void {
  ipcMain.handle(channels.installCheck, (_event, path: unknown, device: unknown) =>
    toResult(() =>
      ovd.install.check(requireText(path, 'path'), { device: requireText(device, 'device') })
    )
  )
  ipcMain.handle(channels.install, (_event, path: unknown, device: unknown) =>
    toResult(() =>
      ovd.install.install(requireText(path, 'path'), { device: requireText(device, 'device') })
    )
  )
}
