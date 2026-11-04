// Loaded with `-r` before the desktop app's main on macOS (harness/gui.ts), so a local e2e run
// doesn't take over the developer's screen: every test launches its own app, several at once.
// OVD_E2E_SHOW=1 turns it off to watch a run.
// CommonJS because Electron loads `-r` modules with require().
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app, BrowserWindow } = require('electron')

// Playwright adds these switches only when it launches its own Electron; the harness passes
// executablePath. A window nobody sees must still render and run timers at full speed.
for (const name of [
  'disable-backgrounding-occluded-windows',
  'disable-renderer-backgrounding',
  'disable-background-timer-throttling'
]) {
  app.commandLine.appendSwitch(name)
}

// No Dock icon, and a new window doesn't activate the app or take focus from the user's.
void app.whenReady().then(() => app.setActivationPolicy('accessory'))

// The window must stay visible to Electron: device polling runs only while it is
// (apps/gui/src/main/devicesIpc.ts). Playwright clicks and types through CDP, so a transparent
// window that lets the mouse through still works for the tests.
BrowserWindow.prototype.show = function show() {
  this.setOpacity(0)
  this.setIgnoreMouseEvents(true)
  this.showInactive()
}
