import type { CrashWatch, CrashWatchOptions } from '@ovd/core'
import type { CrashNewEvent } from '../preload/api'

// What the watcher needs of a window: `BrowserWindow` has all of it.
export interface VisibilityWindow {
  isVisible(): boolean
  isMinimized(): boolean
  isDestroyed(): boolean
  on(event: 'show' | 'hide' | 'minimize' | 'restore' | 'closed', listener: () => void): unknown
}

export interface CrashWatcher {
  // Follows the window: polling runs while it is visible and not minimized, whatever screen is
  // shown, so the toast and the badge work everywhere (as the devices watcher does).
  watch(win: VisibilityWindow): void
  stop(): void
  running(): boolean
}

// Main's crash watcher (Stage 5.1): core polls the target's vault every 5 s. No device is
// named, so core follows the selected target itself. Core keeps the NEW baseline and the set of
// announced reports per device across restarts, so stopping and starting it on visibility
// changes neither repeats a toast nor loses one.
export function createCrashWatcher(deps: {
  watch: (opts: CrashWatchOptions) => CrashWatch
  send: (event: CrashNewEvent) => void
}): CrashWatcher {
  let current: CrashWatch | undefined

  const start = (): void => {
    if (current) return
    current = deps.watch({
      onNew: (crash, device) => deps.send({ device, crash }),
      // A failed poll is shown by the screens when they list; the watcher stays quiet.
      onError: () => undefined
    })
  }
  const stop = (): void => {
    current?.stop()
    current = undefined
  }

  return {
    stop,
    running: () => current !== undefined,
    watch(win) {
      const sync = (): void => {
        if (!win.isDestroyed() && win.isVisible() && !win.isMinimized()) start()
        else stop()
      }
      win.on('show', sync)
      win.on('hide', sync)
      win.on('minimize', sync)
      win.on('restore', sync)
      win.on('closed', stop)
      sync()
    }
  }
}
