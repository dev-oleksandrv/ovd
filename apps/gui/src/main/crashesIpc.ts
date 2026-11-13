import { realpath } from 'node:fs/promises'
import { clipboard, ipcMain, shell, type BrowserWindow } from 'electron'
import { agentPrompt, type Ovd } from '@ovd/core'
import { channels, type CrashCopied, type IpcResult } from '../preload/api'
import { createCrashWatcher, type CrashWatcher } from './crashWatcher'
import { crashRef, crashReportPath, requireText } from './guards'
import { toResult } from './ipcResult'

const keyOf = (device: string, id: number): string => `${device}\n${id}`

// Debug → Crashes (Stage 5.1). The renderer names a crash by `{device, id}` and never sends a
// path: main keeps its own record of where each pull went, checks it against the crashes folder
// before it copies or shows it, and builds the prompt itself.
export function registerCrashesIpc(
  ovd: Ovd,
  window: () => BrowserWindow | undefined
): CrashWatcher {
  // Where main's pulls went, by device and vault index. In memory only.
  const pulled = new Map<string, string>()
  const inflight = new Map<string, Promise<CrashCopied>>()

  // The record, when its file is still an `.acr` inside the crashes folder.
  const recorded = async (device: string, id: number): Promise<string | null> => {
    const path = pulled.get(keyOf(device, id))
    if (path === undefined) return null
    try {
      return await crashReportPath(path, ovd.crashes.dir(), (p) => realpath(p))
    } catch {
      // Removed or moved since: it counts as not downloaded.
      pulled.delete(keyOf(device, id))
      return null
    }
  }

  // The host path of the report, pulled first when it isn't there yet. Two asks at once share
  // one pull.
  const ensure = (device: string, id: number): Promise<CrashCopied> => {
    const key = keyOf(device, id)
    const running = inflight.get(key)
    if (running) return running
    const task = (async (): Promise<CrashCopied> => {
      const have = await recorded(device, id)
      if (have !== null) return { path: have, downloaded: false }
      const result = await ovd.crashes.pull({ device, id })
      const path = await crashReportPath(result.path, ovd.crashes.dir(), (p) => realpath(p))
      pulled.set(key, path)
      return { path, downloaded: true }
    })().finally(() => inflight.delete(key))
    inflight.set(key, task)
    return task
  }

  ipcMain.handle(channels.crashesList, (_event, device: unknown) =>
    toResult(() => ovd.crashes.list(requireText(device, 'device')))
  )
  ipcMain.handle(channels.crashesDetail, (_event, value: unknown) => {
    const { device, id } = crashRef(value)
    return toResult(() => ovd.crashes.detail(id, device))
  })
  ipcMain.handle(channels.crashesPull, (_event, value: unknown) => {
    const { device, id } = crashRef(value)
    return toResult(async () => {
      const result = await ovd.crashes.pull({ device, id })
      pulled.set(
        keyOf(device, id),
        await crashReportPath(result.path, ovd.crashes.dir(), (p) => realpath(p))
      )
      return result
    })
  })
  ipcMain.handle(channels.crashesCopyPath, (_event, value: unknown) => {
    const { device, id } = crashRef(value)
    return toResult(async () => {
      const copied = await ensure(device, id)
      clipboard.writeText(copied.path)
      return copied
    })
  })
  ipcMain.handle(channels.crashesCopyPrompt, (_event, value: unknown) => {
    const { device, id } = crashRef(value)
    return toResult(async () => {
      // The detail first: it is the scope check, and it fails before any pull.
      const { crash, reason, stack } = await ovd.crashes.detail(id, device)
      const copied = await ensure(device, id)
      clipboard.writeText(
        agentPrompt({
          detail: { crash, stack, ...(reason === undefined ? {} : { reason }) },
          path: copied.path
        })
      )
      return copied
    })
  })
  ipcMain.handle(
    channels.crashesReveal,
    async (_event, value: unknown): Promise<IpcResult<null>> => {
      const { device, id } = crashRef(value)
      const real = await recorded(device, id)
      if (real === null) {
        return {
          ok: false,
          error: {
            code: 'PATH_NOT_FOUND',
            message: 'That crash report isn’t downloaded',
            hint: 'Download it first'
          }
        }
      }
      shell.showItemInFolder(real)
      return { ok: true, data: null }
    }
  )

  return createCrashWatcher({
    watch: (opts) => ovd.crashes.watch(opts),
    send: (event) => {
      const win = window()
      if (win && !win.isDestroyed()) win.webContents.send(channels.crashesNew, event)
    }
  })
}
