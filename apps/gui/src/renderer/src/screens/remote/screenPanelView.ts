import type { Device, ErrorJson, ScreenshotResult } from '@ovd/core'
import type { ScreenFramePush, ScreenState } from '../../../../preload/api'

// The live view's label (ROADMAP 4.4).
export const LIVE_LABEL = 'Live · emulator gRPC'

// What the screen view shows for the target. The Virtual Device streams its screen; a stick
// shows its latest screenshot, out of date once a key or text was sent after it.
export type ScreenView =
  | { kind: 'no-signal'; name: string; status: Device['status'] }
  | { kind: 'waiting'; name: string }
  | { kind: 'connecting'; name: string }
  | { kind: 'live' }
  | { kind: 'error'; error: ErrorJson }
  | { kind: 'stick'; shot: ScreenshotResult | null; stale: boolean }

export interface StickShot {
  shot: ScreenshotResult | null
  // Whether a key or text went to the device after the shot.
  stale: boolean
}

export function screenView(target: Device, live: ScreenState, stick: StickShot): ScreenView {
  // A booting Virtual Device is waited for, not "No signal".
  if (target.kind === 'vvd' && target.status === 'starting') {
    return { kind: 'waiting', name: target.name }
  }
  if (target.status !== 'online') {
    return { kind: 'no-signal', name: target.name, status: target.status }
  }
  if (target.kind !== 'vvd') return { kind: 'stick', shot: stick.shot, stale: stick.stale }
  const forTarget = live.target?.id === target.id
  if (forTarget && live.status === 'live') return { kind: 'live' }
  if (forTarget && live.status === 'no-signal') {
    return { kind: 'no-signal', name: target.name, status: 'offline' }
  }
  if (forTarget && live.status === 'error' && live.error) {
    return { kind: 'error', error: live.error }
  }
  return { kind: 'connecting', name: target.name }
}

// "No signal"'s line: what happened to the device.
export function noSignalText(name: string, status: Device['status']): string {
  return `${name} is ${status === 'stopped' ? 'stopped' : 'offline'}`
}

// `ovd screenshot --device <id>`: what a stick's Refresh runs (ADR 0005).
export function refreshCli(device: string): string {
  return `ovd screenshot --device ${device}`
}

// "Latest screenshot · 14:03:12", in local time (ROADMAP 4.4).
export function latestLabel(takenAt: string): string {
  const time = new Date(takenAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Latest screenshot · ${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`
}

// A frame the canvas can draw: RGBA8888, exactly width*height*4 bytes.
export function drawable(frame: ScreenFramePush): boolean {
  return (
    Number.isInteger(frame.width) &&
    Number.isInteger(frame.height) &&
    frame.width > 0 &&
    frame.height > 0 &&
    frame.pixels instanceof Uint8Array &&
    frame.pixels.length === frame.width * frame.height * 4
  )
}
