import { ipcMain, type BrowserWindow } from 'electron'
import type { Ovd } from '@ovd/core'
import { channels } from '../preload/api'
import { createInputController, type InputController } from './inputController'

// Debug → Remote & Screen (Stage 4.2): the input session main keeps for the target.
export function registerInputIpc(
  ovd: Ovd,
  window: () => BrowserWindow | undefined
): InputController {
  const controller = createInputController({
    input: ovd.input,
    send: (state) => {
      const win = window()
      if (win && !win.isDestroyed()) win.webContents.send(channels.inputUpdate, state)
    }
  })
  ipcMain.handle(channels.inputOpen, (_event, device: unknown) => controller.open(device))
  ipcMain.handle(channels.inputPress, (_event, key: unknown) => controller.press(key))
  ipcMain.handle(channels.inputText, (_event, text: unknown) => controller.text(text))
  ipcMain.handle(channels.inputState, () => controller.state())
  return controller
}
