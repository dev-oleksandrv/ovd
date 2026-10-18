import type { ReactNode } from 'react'
import { cx } from './cx'

interface BadgeProps {
  children: ReactNode
  tone?: 'error' | 'warning' | 'accent'
}

const tones = {
  error: 'bg-error/14 text-error-soft',
  warning: 'bg-warning/14 text-warning',
  accent: 'bg-accent text-accent-ink'
}

// Count badge used in the sidebar and on tabs.
export function Badge({ children, tone = 'error' }: BadgeProps) {
  return (
    <span className={cx('rounded-[10px] px-1.5 py-px font-mono text-micro', tones[tone])}>
      {children}
    </span>
  )
}
