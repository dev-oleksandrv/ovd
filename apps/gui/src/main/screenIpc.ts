import { ipcMain, type BrowserWindow } from 'electron'
import type { Ovd } from '@ovd/core'
import { channels } from '../preload/api'
import { createScreenController, type ScreenController } from './screenController'

// Remote & Screen's live view and a stick's latest screenshot (Stage 4.4).
export function registerScreenIpc(
  ovd: Ovd,
  window: () => BrowserWindow | undefined
): ScreenController {
  const send = (channel: string, payload: unknown) => {
    const win = window()
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
  const controller = createScreenController({
    screen: ovd.screen,
    devices: ovd.devices,
    screenshot: ovd.screenshot,
    sendFrame: (frame) => send(channels.screenFrame, frame),
    sendState: (state) => send(channels.screenState, state),
    sendCaptures: (list) => send(channels.screenshotCapturesUpdate, list)
  })
  ipcMain.handle(channels.screenStart, (_event, device: unknown) => controller.start(device))
  ipcMain.handle(channels.screenStop, () => controller.stop())
  ipcMain.handle(channels.screenAck, (_event, seq: unknown) => controller.ack(seq))
  ipcMain.handle(channels.screenRefresh, (_event, device: unknown) => controller.refresh(device))
  ipcMain.handle(channels.screenImage, (_event, path: unknown) => controller.image(path))
  return controller
}
