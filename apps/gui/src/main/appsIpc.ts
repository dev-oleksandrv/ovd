import { ipcMain } from 'electron'
import type { Ovd } from '@ovd/core'
import { channels } from '../preload/api'
import { requireText } from './guards'
import { toResult } from './ipcResult'

// Apps → read (Stage 2.4a). The renderer names the device it shows, so the list and the
// detail read the same one.
export function registerAppsIpc(ovd: Ovd): void {
  ipcMain.handle(channels.appsList, (_event, device: unknown, running: unknown) =>
    toResult(() =>
      ovd.apps.list({
        device: requireText(device, 'device'),
        ...(running === true ? { running: true } : {})
      })
    )
  )
  ipcMain.handle(channels.appsInfo, (_event, ref: unknown, device: unknown) =>
    toResult(() =>
      ovd.apps.info(requireText(ref, 'app'), { device: requireText(device, 'device') })
    )
  )
}
