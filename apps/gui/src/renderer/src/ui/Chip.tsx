import type { ReactNode } from 'react'
import { cx } from './cx'

interface ChipProps {
  children: ReactNode
  variant?: 'outline' | 'accent'
  mono?: boolean
}

// Small label: connection type, architecture, "Target", keyboard hints.
export function Chip({ children, variant = 'outline', mono = false }: ChipProps) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center rounded-chip px-1.5 py-px whitespace-nowrap',
        mono ? 'font-mono text-label' : 'text-micro',
        variant === 'outline' ? 'border border-line-strong text-muted' : 'bg-accent/12 text-accent'
      )}
    >
      {children}
    </span>
  )
}
