import type { VvdState } from '@ovd/core'

export function vvdStatusLine(state: VvdState): string {
  const arch = state.status === 'online' ? state.device.info?.architecture : undefined
  return `Virtual Device: ${state.status}${arch ? ` (${arch})` : ''}\n`
}

export function vvdStartedLine(state: VvdState): string {
  const arch = state.device.info?.architecture
  return `Virtual Device started (${state.device.id}${arch ? ` · ${arch}` : ''})\n`
}
