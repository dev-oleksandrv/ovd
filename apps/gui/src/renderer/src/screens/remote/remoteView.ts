import type { Device, InputBackend, RemoteKey } from '@ovd/core'
import type { InputState } from '../../../../preload/api'
import { appsBlocker } from '../apps/appsView'

// The Virtual Device can't take Home (ADR 0010); the pad says why.
export const HOME_UNSUPPORTED = 'Home can’t be sent to the Virtual Device'

export interface PadKey {
  key: RemoteKey
  label: string
  icon?: string
  text?: string
}

export const PAD_KEYS: Record<RemoteKey, PadKey> = {
  up: { key: 'up', label: 'Up', icon: 'keyboard_arrow_up' },
  down: { key: 'down', label: 'Down', icon: 'keyboard_arrow_down' },
  left: { key: 'left', label: 'Left', icon: 'keyboard_arrow_left' },
  right: { key: 'right', label: 'Right', icon: 'keyboard_arrow_right' },
  ok: { key: 'ok', label: 'OK', text: 'OK' },
  back: { key: 'back', label: 'Back', icon: 'arrow_back' },
  home: { key: 'home', label: 'Home', icon: 'home' },
  menu: { key: 'menu', label: 'Menu', icon: 'menu' },
  rewind: { key: 'rewind', label: 'Rewind', icon: 'fast_rewind' },
  'play-pause': { key: 'play-pause', label: 'Play/pause', icon: 'play_pause' },
  'fast-forward': { key: 'fast-forward', label: 'Fast-forward', icon: 'fast_forward' }
}

// Why a key can't be pressed on this backend, or null.
export function keyDisabledReason(key: RemoteKey, backend: InputBackend | null): string | null {
  return key === 'home' && backend === 'grpc' ? HOME_UNSUPPORTED : null
}

// What the panel calls each backend.
export function backendLabel(backend: InputBackend): string {
  return backend === 'grpc' ? 'Emulator gRPC' : 'inputd-cli'
}

// Which state the screen shows, the session for the target deciding once the target is online.
export type RemoteView =
  | { kind: 'no-target' }
  | { kind: 'offline'; name: string }
  | { kind: 'loading'; name: string }
  | { kind: 'error'; state: InputState & { status: 'error' } }
  | { kind: 'ready'; state: InputState & { status: 'ready' } }

export function remoteView(target: Device | undefined, state: InputState): RemoteView {
  const blocker = appsBlocker(target)
  if (!target || blocker === 'no-target') return { kind: 'no-target' }
  if (blocker === 'offline') return { kind: 'offline', name: target.name }
  const forTarget = state.target?.id === target.id
  if (forTarget && state.status === 'error') {
    return { kind: 'error', state: state as InputState & { status: 'error' } }
  }
  if (forTarget && state.status === 'ready') {
    return { kind: 'ready', state: state as InputState & { status: 'ready' } }
  }
  return { kind: 'loading', name: target.name }
}
