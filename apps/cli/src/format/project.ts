import type { ProjectMode } from '@ovd/core'

// "OS 1.2 · RN 0.83", leaving out what the project doesn't pin.
export function pinsText(mode: ProjectMode): string {
  if (mode.kind !== 'folder') return ''
  const pins = [
    mode.osTarget === undefined ? null : `OS ${mode.osTarget}`,
    mode.rnVersion === undefined ? null : `RN ${mode.rnVersion}`
  ].filter((p): p is string => p !== null)
  return pins.length === 0 ? '' : ` · ${pins.join(' · ')}`
}

export function projectLine(mode: ProjectMode): string {
  if (mode.kind === 'vpkg') {
    const gone = mode.missing ? ' (file not found)' : ''
    return `No project · installing from ${mode.file} (${mode.displayPath})${gone}\n`
  }
  const gone = mode.missing ? ' (no longer a Vega project)' : ''
  return `Project: ${mode.name} (${mode.displayPath})${pinsText(mode)}${gone}\n`
}

export function openedLine(mode: ProjectMode): string {
  return mode.kind === 'vpkg'
    ? `Loaded ${mode.file} · no project mode\n`
    : `Opened ${mode.name} (${mode.displayPath})${pinsText(mode)}\n`
}
