import { mkdir, realpath } from 'node:fs/promises'
import type { CapturesList, Ovd } from '@ovd/core'
import type { IpcResult, ScreenshotTaken } from '../preload/api'
import { capturePath, inputText } from './guards'
import { toResult } from './ipcResult'

export interface ScreenshotController {
  // `ovd screenshot --clipboard --device <id>`: takes it, copies it, then pushes the list.
  take(device: unknown): Promise<IpcResult<ScreenshotTaken>>
  captures(): Promise<IpcResult<CapturesList>>
  // The real path of a capture to show in its folder; TypeError for anything else.
  revealable(path: unknown): Promise<string>
  // The captures folder, created when missing, to open.
  folder(): Promise<string>
}

// Remote & Screen's Screenshot (Stage 4.3). Main copies to the clipboard itself (Electron's
// clipboard), so the copy is a host action after the logged capture, as for the CLI.
export function createScreenshotController(deps: {
  screenshot: Ovd['screenshot']
  // Copies the PNG at `path`; false when it couldn't (an image Electron can't read).
  copyImage: (path: string) => Promise<boolean>
  // Pushes the captures list to the window after each take.
  send: (list: CapturesList) => void
  realpath?: (path: string) => Promise<string>
}): ScreenshotController {
  const real = deps.realpath ?? ((path: string) => realpath(path))

  const push = async () => {
    const list = await deps.screenshot.captures().catch(() => null)
    if (list) deps.send(list)
  }

  return {
    async take(value) {
      const device = inputText(value, 'device')
      const result = await toResult(async () => {
        const shot = await deps.screenshot.take({ device })
        const copied = await deps.copyImage(shot.path).catch(() => false)
        return { ...shot, copied }
      })
      if (result.ok) await push()
      return result
    },

    captures: () => toResult(() => deps.screenshot.captures()),

    revealable: (path) => capturePath(path, deps.screenshot.dir(), real),

    async folder() {
      const dir = deps.screenshot.dir()
      await mkdir(dir, { recursive: true })
      return dir
    }
  }
}
