import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { createOvd, processGroups } from '@ovd/core'
import { registerAppsIpc } from './appsIpc'
import { registerDevicesIpc } from './devicesIpc'
import { registerInstallIpc } from './installIpc'
import { registerIpcHandlers } from './ipc'
import { registerLogsIpc } from './logsIpc'
import { registerPackagesIpc } from './packagesIpc'
import { registerPairingIpc } from './pairingIpc'
import { registerProjectIpc } from './projectIpc'
import { registerQuitHooks } from './quitHooks'
import { registerRunIpc } from './runIpc'
import { registerSetupIpc } from './setupIpc'
import { showWhenReady } from './showWindow'
import { registerVvdIpc } from './vvdIpc'
import { registerWatchIpc } from './watchIpc'
import type { WatchController } from './watchController'

// One core for the app's lifetime (ADR 0001): the desktop never shells out to `ovd`.
const ovd = createOvd({ surface: 'desktop' })
let mainWindow: BrowserWindow | undefined
// Before `devices`: main's log session follows every target change the device watcher sees.
const logs = registerLogsIpc(ovd, () => mainWindow)
const devices = registerDevicesIpc(
  ovd,
  () => mainWindow,
  (update) => {
    if (update.ok) logs.targetChanged(update.target)
  }
)
// Quitting stops the probes and the log stream in flight and waits for the log session, then
// SIGTERMs any SDK process group still running.
const quitting = registerQuitHooks(app, { logs, stopAll: () => processGroups.stopAll() })
// Set once the IPC handlers are registered; watching stops on quit and with the window.
let watch: WatchController | undefined
app.on('before-quit', () => watch?.stop())

function createWindow(): void {
  // Create the browser window.
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    // Matches the design's background token so no white flash shows before the renderer paints.
    backgroundColor: '#0B0E12',
    // On macOS the app draws its own title bar and the traffic lights sit inside it.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 15 } }
      : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow = win
  devices.watch(win)
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined
  })
  // The log stream's process group goes with the window (no orphans on the host or device).
  win.on('closed', () => void logs.stop())
  win.on('closed', () => watch?.stop())

  showWhenReady(win)

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers(ovd, quitting)
  registerVvdIpc(ovd, devices.refresh)
  registerPairingIpc(ovd, devices.refresh)
  registerProjectIpc(ovd, () => mainWindow)
  registerPackagesIpc(ovd, () => mainWindow)
  registerInstallIpc(ovd)
  registerAppsIpc(ovd)
  const run = registerRunIpc(ovd, logs, () => mainWindow)
  watch = registerWatchIpc(ovd, run, logs, () => mainWindow)
  registerSetupIpc(ovd, () => mainWindow, devices.refresh)

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
