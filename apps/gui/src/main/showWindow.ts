// The parts of a BrowserWindow this needs, so tests can pass a fake.
export interface ShowableWindow {
  show(): void
  isVisible(): boolean
  isDestroyed(): boolean
  once(event: 'ready-to-show' | 'closed', listener: () => void): unknown
}

// `ready-to-show` usually comes within 0.4 s (0.9 s at the 95th percentile on CI runners).
export const SHOW_FALLBACK_MS = 1_000

// Shows the window on its first paint, as Electron recommends, so no blank frame flashes. But
// the first paint can come late or never when the GPU process is slow to start (seen under
// Xvfb on CI: no `ready-to-show` after 3 s, once 9 s late). A window never shown also never
// polls devices (devicesIpc.ts), so after the fallback it is shown anyway, on the background
// color it was created with.
export function showWhenReady(win: ShowableWindow, fallbackMs = SHOW_FALLBACK_MS): void {
  const show = (): void => {
    clearTimeout(fallback)
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  }
  const fallback = setTimeout(show, fallbackMs)
  win.once('ready-to-show', show)
  win.once('closed', () => clearTimeout(fallback))
}
