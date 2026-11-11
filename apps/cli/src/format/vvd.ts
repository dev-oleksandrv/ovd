import type { VvdStartResult, VvdState } from '@ovd/core'

export function vvdStatusLine(state: VvdState): string {
  const arch = state.status === 'online' ? state.device.info?.architecture : undefined
  return `Virtual Device: ${state.status}${arch ? ` (${arch})` : ''}\n`
}

export function vvdStartedLine(state: VvdStartResult): string {
  const arch = state.device.info?.architecture
  const started = `Virtual Device started (${state.device.id}${arch ? ` · ${arch}` : ''})\n`
  return state.grpc.status === 'on' ? `${started}Emulator gRPC on · :${state.grpc.port}\n` : started
}

// On stderr: the start worked, but keys and screenshots won't until gRPC is on.
export function vvdGrpcWarning(state: VvdStartResult): string | null {
  if (state.grpc.status !== 'failed') return null
  const { message, hint } = state.grpc.error
  return `! Emulator gRPC couldn’t be turned on: ${message}\n  → ${hint}\n`
}
