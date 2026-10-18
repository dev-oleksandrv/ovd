import { cx } from './cx'
import { toneBg, type Tone } from './tone'

interface StatusDotProps {
  tone: Tone
  size?: 6 | 7 | 8
  pulse?: boolean
}

const sizes = { 6: 'size-1.5', 7: 'size-[7px]', 8: 'size-2' }

export function StatusDot({ tone, size = 7, pulse = false }: StatusDotProps) {
  return (
    <span
      aria-hidden
      className={cx(
        'inline-block shrink-0 rounded-full',
        sizes[size],
        toneBg[tone],
        pulse && 'animate-pulse-dot'
      )}
    />
  )
}
