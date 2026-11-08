import type { ReactNode } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'

interface ToggleButtonProps {
  children: ReactNode
  pressed: boolean
  onChange: (pressed: boolean) => void
  icon?: string
  // Accessible name when the label is a symbol (`.*` for Regex).
  label?: string
  mono?: boolean
}

// A button that stays on or off (`aria-pressed`): the Logs Regex toggle and Follow.
export function ToggleButton({
  children,
  pressed,
  onChange,
  icon,
  label,
  mono = false
}: ToggleButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={() => onChange(!pressed)}
      className={cx(
        'inline-flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 rounded-control border px-2.5 whitespace-nowrap',
        mono && 'font-mono text-small',
        pressed
          ? 'border-accent-line bg-accent/12 text-accent'
          : 'border-line-strong bg-control text-muted hover:bg-control-hover hover:text-text'
      )}
    >
      {icon && <Icon name={icon} size={17} />}
      {children}
    </button>
  )
}
