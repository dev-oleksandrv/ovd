import type { Device } from '@ovd/core'
import type { ScreenshotTaken } from '../../../preload/api'

// `ovd screenshot --clipboard --device <id>`: what the desktop's Screenshot runs (ADR 0005).
export function screenshotCli(device: string): string {
  return `ovd screenshot --clipboard --device ${device}`
}

// Why Screenshot can't run now (the button's tooltip), or null.
export function screenshotBlocker(target: Device | undefined): string | null {
  if (!target) return 'No target device'
  if (target.status !== 'online')
    return `${target.name} is ${target.status === 'stopped' ? 'stopped' : 'offline'}`
  return null
}

// The file name of a saved capture, for the toast.
export function fileName(path: string): string {
  return path.split(/[/\\]/).at(-1) ?? path
}

// The toast for a take that saved: ok when it reached the clipboard, a warning when it didn't.
export function savedToast(shot: ScreenshotTaken): { tone: 'ok' | 'warning'; text: string } {
  const name = fileName(shot.path)
  return shot.copied
    ? { tone: 'ok', text: `Saved ${name} · copied to the clipboard` }
    : { tone: 'warning', text: `Saved ${name} · couldn’t copy it to the clipboard` }
}

// "9.6 KB", "1.2 MB".
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
