// DIAGNOSTIC (branch test/e2e-window-diagnostics, not for main): loaded with `-r` before the
// desktop app's main, it records when the window is created, painted and shown, and whether the
// GPU or renderer process died, into the file named by OVD_E2E_DIAG.
// CommonJS because Electron loads `-r` modules with require().
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app } = require('electron')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { appendFileSync } = require('node:fs')

const file = process.env.OVD_E2E_DIAG
const t0 = Date.now()

function log(event, data = {}) {
  if (!file) return
  try {
    appendFileSync(file, `${JSON.stringify({ t: Date.now() - t0, event, ...data })}\n`)
  } catch {
    // The test may have ended and removed its output folder.
  }
}

log('main-start', { platform: process.platform, electron: process.versions.electron })

app.on('ready', () => {
  log('app-ready', { gpu: app.getGPUFeatureStatus() })
  setTimeout(() => log('gpu-3s', { gpu: app.getGPUFeatureStatus() }), 3_000).unref()
})
app.on('child-process-gone', (_event, details) => log('child-process-gone', details))
app.on('render-process-gone', (_event, _contents, details) => log('render-process-gone', details))
app.on('gpu-info-update', () => log('gpu-info-update'))

app.on('browser-window-created', (_event, win) => {
  log('window-created', { visible: win.isVisible() })
  win.once('ready-to-show', () => log('ready-to-show'))
  win.on('show', () => log('show', { visible: win.isVisible() }))
  win.on('hide', () => log('hide'))
  win.on('minimize', () => log('minimize'))
  win.webContents.once('did-finish-load', () => log('did-finish-load'))
  win.webContents.on('unresponsive', () => log('unresponsive'))
  win.webContents.on('responsive', () => log('responsive'))
  for (const ms of [1_000, 3_000, 10_000]) {
    setTimeout(() => {
      if (win.isDestroyed()) return
      log(`probe-${ms}`, {
        visible: win.isVisible(),
        minimized: win.isMinimized(),
        bounds: win.getBounds()
      })
    }, ms).unref()
  }
})
