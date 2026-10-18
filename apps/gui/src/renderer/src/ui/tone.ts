export type Tone = 'ok' | 'warning' | 'error' | 'info' | 'muted'

// Class names per tone. Kept as full literals so Tailwind can see them.
export const toneText: Record<Tone, string> = {
  ok: 'text-accent',
  warning: 'text-warning',
  error: 'text-error',
  info: 'text-info',
  muted: 'text-muted'
}

export const toneBg: Record<Tone, string> = {
  ok: 'bg-accent',
  warning: 'bg-warning',
  error: 'bg-error',
  info: 'bg-info',
  muted: 'bg-muted'
}

export const toneTint: Record<Tone, string> = {
  ok: 'bg-accent/12 text-accent',
  warning: 'bg-warning/14 text-warning',
  error: 'bg-error/14 text-error-soft',
  info: 'bg-info/14 text-info',
  muted: 'bg-muted/12 text-muted'
}

export const toneBorder: Record<Tone, string> = {
  ok: 'border-l-accent',
  warning: 'border-l-warning',
  error: 'border-l-error',
  info: 'border-l-info',
  muted: 'border-l-muted'
}

export const toneIcon: Record<Tone, string> = {
  ok: 'check_circle',
  warning: 'warning',
  error: 'error',
  info: 'info',
  muted: 'info'
}
