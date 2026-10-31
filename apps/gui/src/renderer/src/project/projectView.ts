import type { ProjectMode } from '@ovd/core'
import type { ToastInput } from '../feedback/feedbackContext'

// "OS 1.2 · RN 0.83": what the project pins. A Vega project records no SDK version.
export function pinsLine(mode: ProjectMode): string | null {
  if (mode.kind !== 'folder') return null
  const pins = [
    mode.osTarget === undefined ? null : `OS ${mode.osTarget}`,
    mode.rnVersion === undefined ? null : `RN ${mode.rnVersion}`
  ].filter((p): p is string => p !== null)
  return pins.length === 0 ? null : pins.join(' · ')
}

export function openCli(mode: ProjectMode): string {
  return `ovd open ${mode.displayPath}`
}

export function openedToast(mode: ProjectMode): ToastInput {
  const text = mode.kind === 'vpkg' ? `Loaded ${mode.file}` : `Opened ${mode.name}`
  return { tone: 'ok', text, cli: openCli(mode) }
}
