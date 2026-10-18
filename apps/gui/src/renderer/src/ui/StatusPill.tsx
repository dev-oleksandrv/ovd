import type { ReactNode } from 'react'
import { cx } from './cx'
import { StatusDot } from './StatusDot'
import { toneTint, type Tone } from './tone'

interface StatusPillProps {
  tone: Tone
  children: ReactNode
  pulse?: boolean
}

// Tinted status with a dot, e.g. "Running · 4182" or "Crashed on launch".
export function StatusPill({ tone, children, pulse = false }: StatusPillProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-control-sm px-2 py-[3px] text-meta whitespace-nowrap',
        toneTint[tone]
      )}
    >
      <StatusDot tone={tone} size={6} pulse={pulse} />
      {children}
    </span>
  )
}
