import type { InputBackend, RemoteKey } from '@ovd/core'

// The keyboard's remote (KeyboardHint): arrows, Enter = OK, Esc or Backspace = Back, Space =
// play/pause, H = Home, M = Menu, `,` and `.` = rewind and fast-forward.
const KEYS: Record<string, RemoteKey> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'ok',
  Escape: 'back',
  Backspace: 'back',
  ' ': 'play-pause',
  h: 'home',
  H: 'home',
  m: 'menu',
  M: 'menu',
  ',': 'rewind',
  '.': 'fast-forward'
}

// Where every key belongs to the control, not the remote: typing, and controls that move with
// arrows (tabs, menus, options).
const OWN_KEYS =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), ' +
  '[role="textbox"], [role="tab"], [role="menuitem"], [role="option"]'
// Controls that Enter and Space activate (a pad key handles its own click). Other keys pass, so
// the keyboard's remote still works with a sidebar button or a pad key focused.
const ACTIVATES = 'button, a, [role="button"]'
const ACTIVATING_KEYS = new Set(['Enter', ' '])

export type RemoteKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'repeat' | 'defaultPrevented' | 'target'
>

// The remote key a keydown sends, or null when the remote must ignore it: a shortcut (⌘, Ctrl,
// Alt), a held key repeating, an event already handled, one aimed at a field, Enter or Space on a
// button or link, anything while a dialog or menu is open, and Home where the backend can't send
// it.
export function keyFor(
  event: RemoteKeyEvent,
  opts: { backend: InputBackend | null; overlayOpen: boolean }
): RemoteKey | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null
  if (event.repeat || event.defaultPrevented || opts.overlayOpen) return null
  const target = event.target
  if (target instanceof Element) {
    if (target.closest(OWN_KEYS)) return null
    if (ACTIVATING_KEYS.has(event.key) && target.closest(ACTIVATES)) return null
    if (target instanceof HTMLElement && target.isContentEditable) return null
  }
  const key = KEYS[event.key]
  if (key === undefined) return null
  if (key === 'home' && opts.backend === 'grpc') return null
  return key
}

// A palette, modal or menu is open: the remote stays quiet.
export function overlayOpen(doc: Document = document): boolean {
  return doc.querySelector('[role="dialog"], [role="menu"]') !== null
}
