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
  disabled?: boolean
  // Shown as a tooltip when disabled: every disabled action says why.
  disabledReason?: string
}

// A button that stays on or off (`aria-pressed`): the Logs Regex toggle, Follow, and the title
// bar's Watch.
export function ToggleButton({
  children,
  pressed,
  onChange,
  icon,
  label,
  mono = false,
  disabled = false,
  disabledReason
}: ToggleButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={disabled ? (disabledReason ?? label) : label}
      disabled={disabled}
      onClick={disabled ? undefined : () => onChange(!pressed)}
      className={cx(
        'inline-flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 rounded-control border px-2.5 whitespace-nowrap',
        mono && 'font-mono text-small',
        disabled
          ? 'cursor-not-allowed border-line-strong bg-disabled text-faint'
          : pressed
            ? 'border-accent-line bg-accent/12 text-accent'
            : 'border-line-strong bg-control text-muted hover:bg-control-hover hover:text-text'
      )}
    >
      {icon && <Icon name={icon} size={17} />}
      {children}
    </button>
  )
}
