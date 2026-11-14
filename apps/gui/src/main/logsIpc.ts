import { stat } from 'node:fs/promises'
import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { writeLogExport, type LogExportFormat, type Ovd } from '@ovd/core'
import { channels, type IpcResult, type LogsExportResult } from '../preload/api'
import {
  logsBundleRequest,
  logsExportRequest,
  logsFilter,
  requireFlag,
  requireText,
  saveLogsFilterRequest,
  savedFilterRef
} from './guards'
import { toResult } from './ipcResult'
import { createLogsController, type LogsController } from './logsController'

const FILTERS: Record<LogExportFormat, { name: string; extensions: [string] }> = {
  text: { name: 'Plain text', extensions: ['txt'] },
  jsonl: { name: 'JSON lines', extensions: ['jsonl'] }
}

// Debug → Logs (Stage 3.1). Main runs the session and batches its updates (gui rules): the
// renderer gets at most one append per ~100 ms.
export function registerLogsIpc(
  ovd: Ovd,
  window: () => BrowserWindow | undefined
): {
  stop(): Promise<void>
  running(): boolean
  targetChanged(target: string | null): void
  // The run's log step (`runIpc.ts`) goes through the same session.
  armRestart: LogsController['armRestart']
  follow: LogsController['follow']
  // Watch makes sure a session follows the target (`watchIpc.ts`).
  open: LogsController['open']
  device: LogsController['device']
} {
  const controller = createLogsController({
    logs: ovd.logs,
    logFilters: ovd.logFilters,
    logBundle: ovd.logBundle,
    send: (update) => {
      const win = window()
      if (win && !win.isDestroyed()) win.webContents.send(channels.logsUpdate, update)
    }
  })

  ipcMain.handle(channels.logsOpen, (_event, device: unknown) =>
    toResult(() => controller.open(requireText(device, 'device')))
  )
  ipcMain.handle(channels.logsRestart, (_event, device: unknown) =>
    toResult(() => controller.restart(requireText(device, 'device')))
  )
  ipcMain.handle(channels.logsFilter, (_event, filter: unknown) =>
    controller.setFilter(logsFilter(filter))
  )
  ipcMain.handle(channels.logsRestartAfterInstall, (_event, on: unknown) =>
    toResult(async () => controller.setRestartAfterInstall(requireFlag(on, 'on')))
  )
  ipcMain.handle(channels.logsClear, () => controller.clear())
  ipcMain.handle(channels.logsExport, (_event, request: unknown) =>
    toResult(async (): Promise<LogsExportResult> => {
      const { format, throughSeq } = logsExportRequest(request)
      const exported = controller.exportEntries(throughSeq)
      if (!exported || exported.until === null) return { status: 'empty' }
      const win = window()
      const options = {
        title: 'Export log lines',
        defaultPath: exportName(new Date(), format),
        filters: [FILTERS[format]]
      }
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return { status: 'canceled' }
      // The dialog already confirmed a replace; the echo then needs `--force`.
      const replaced = await stat(result.filePath).then(
        () => true,
        () => false
      )
      const saved = await writeLogExport(result.filePath, exported.entries, {
        format,
        overwrite: true
      })
      return { status: 'saved', ...saved, until: exported.until, replaced }
    })
  )

  ipcMain.handle(channels.logsPresets, (): IpcResult<ReturnType<LogsController['presets']>> => ({
    ok: true,
    data: controller.presets()
  }))
  ipcMain.handle(channels.logsSavedList, () => controller.savedList())
  ipcMain.handle(channels.logsSavedSave, (_event, request: unknown) =>
    controller.savedSave(saveLogsFilterRequest(request))
  )
  ipcMain.handle(channels.logsSavedRemove, (_event, name: unknown) =>
    controller.savedRemove(savedFilterRef(name))
  )
  ipcMain.handle(channels.logsBundle, (_event, request: unknown) => {
    const { throughSeq, preset } = logsBundleRequest(request)
    return controller.bundle(
      throughSeq,
      async (dir, fileName) => {
        const win = window()
        const options = {
          title: 'Save log bundle',
          defaultPath: join(dir, fileName),
          filters: [{ name: 'Zip archive', extensions: ['zip'] }]
        }
        const result = win
          ? await dialog.showSaveDialog(win, options)
          : await dialog.showSaveDialog(options)
        return result.canceled || !result.filePath ? null : result.filePath
      },
      preset
    )
  })
  ipcMain.handle(channels.logsBundleReveal, (): IpcResult<null> => {
    const path = controller.lastBundle()
    if (path === null) {
      return {
        ok: false,
        error: {
          code: 'PATH_NOT_FOUND',
          message: 'No bundle was saved yet',
          hint: 'Save a bundle first'
        }
      }
    }
    shell.showItemInFolder(path)
    return { ok: true, data: null }
  })

  return {
    stop: () => controller.stop(),
    running: () => controller.running(),
    targetChanged(target) {
      void controller.targetChanged(target)
    },
    armRestart: (device) => controller.armRestart(device),
    follow: (device, arm) => controller.follow(device, arm),
    open: (device) => controller.open(device),
    device: () => controller.device()
  }

  // `ovd-logs-<device>-<YYYYMMDD-HHMMSS>.<txt|jsonl>`, with `:` (an IP:port) as `-`.
  function exportName(now: Date, format: LogExportFormat): string {
    const two = (n: number) => String(n).padStart(2, '0')
    const stamp =
      `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-` +
      `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
    const id = (controller.device() ?? 'device').replaceAll(':', '-')
    return `ovd-logs-${id}-${stamp}.${FILTERS[format].extensions[0]}`
  }
}
