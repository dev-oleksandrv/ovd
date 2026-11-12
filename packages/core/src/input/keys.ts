// The remote's keys, as `ovd input press` takes them and the desktop pad sends them. One map per
// backend (ADR 0010), so a hardware check changes one file.
export const REMOTE_KEYS = [
  'up',
  'down',
  'left',
  'right',
  'ok',
  'back',
  'home',
  'menu',
  'play-pause',
  'rewind',
  'fast-forward'
] as const

export type RemoteKey = (typeof REMOTE_KEYS)[number]

export function isRemoteKey(value: string): value is RemoteKey {
  return (REMOTE_KEYS as readonly string[]).includes(value)
}

// `inputd-cli button_press <name>` on a stick. The Virtual Device accepted every one of these
// names (ARCHITECTURE §8); whether each reaches apps on a stick is unverified (#43).
export const INPUTD_KEYS: Record<RemoteKey, string> = {
  up: 'KEY_UP',
  down: 'KEY_DOWN',
  left: 'KEY_LEFT',
  right: 'KEY_RIGHT',
  ok: 'KEY_ENTER',
  back: 'KEY_BACK',
  home: 'KEY_HOMEPAGE',
  menu: 'KEY_MENU',
  'play-pause': 'KEY_PLAYPAUSE',
  rewind: 'KEY_REWIND',
  'fast-forward': 'KEY_FASTFORWARD'
}

// Evdev key codes for emulator gRPC `sendKey` on the Virtual Device. OK arrives as `kpenter`
// (KEY_KPENTER), and Home can't be sent at all (ADR 0010), so it has no code.
export const GRPC_KEYS: Partial<Record<RemoteKey, number>> = {
  up: 103,
  down: 108,
  left: 105,
  right: 106,
  ok: 96,
  back: 158,
  menu: 139,
  'play-pause': 164,
  rewind: 168,
  'fast-forward': 208
}
