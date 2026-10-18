import type { Tone } from '../ui/tone'

export interface Toast {
  id: number
  tone: Exclude<Tone, 'muted'>
  text: string
  // The CLI equivalent of the action, shown as the toast's second line (ADR 0005).
  cli?: string
  action?: { label: string; run: () => void }
}

export const MAX_TOASTS = 4
export const TOAST_DURATION_MS = 4000

// Newest last; the oldest toast drops off when a fifth arrives.
export function addToast(queue: Toast[], toast: Toast): Toast[] {
  return [...queue, toast].slice(-MAX_TOASTS)
}

export function removeToast(queue: Toast[], id: number): Toast[] {
  return queue.filter((toast) => toast.id !== id)
}
