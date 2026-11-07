import { ipcMain } from 'electron'
import type { Ovd } from '@ovd/core'
import { channels } from '../preload/api'
import { optionalFlag, requireText } from './guards'
import { toResult } from './ipcResult'

// Apps (Stage 2.4): the reads and the actions. The renderer names the device it shows, so the
// list, the detail and every action see the same one.
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
  ipcMain.handle(channels.appsLaunch, (_event, ref: unknown, device: unknown) =>
    toResult(() =>
      ovd.apps.launch(requireText(ref, 'app'), { device: requireText(device, 'device') })
    )
  )
  ipcMain.handle(channels.appsTerminate, (_event, ref: unknown, device: unknown, force: unknown) =>
    toResult(() =>
      ovd.apps.terminate(requireText(ref, 'app'), {
        device: requireText(device, 'device'),
        force: optionalFlag(force, 'force')
      })
    )
  )
  ipcMain.handle(channels.appsRestart, (_event, ref: unknown, device: unknown) =>
    toResult(() =>
      ovd.apps.restart(requireText(ref, 'app'), { device: requireText(device, 'device') })
    )
  )
  ipcMain.handle(channels.appsUninstall, (_event, ref: unknown, device: unknown) =>
    toResult(() =>
      ovd.apps.uninstall(requireText(ref, 'app'), { device: requireText(device, 'device') })
    )
  )
  ipcMain.handle(channels.appsReinstall, (_event, ref: unknown, device: unknown) =>
    toResult(() =>
      ovd.apps.reinstall(requireText(ref, 'app'), { device: requireText(device, 'device') })
    )
  )
}
