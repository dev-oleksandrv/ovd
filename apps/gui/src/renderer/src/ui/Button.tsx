import type { ReactNode } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'

interface ButtonProps {
  children: ReactNode
  onClick?: () => void
  // `blocked` looks disabled but still answers a click, to say why (design: Install on target
  // under an architecture mismatch). `danger` is for destructive confirms (Uninstall).
  variant?: 'primary' | 'secondary' | 'dashed' | 'blocked' | 'danger'
  size?: 'md' | 'sm'
  icon?: string
  loading?: boolean
  disabled?: boolean
  // Shown as a tooltip when disabled: every disabled action says why.
  disabledReason?: string
  // For a button that shows or hides something (`aria-expanded`).
  expanded?: boolean
  // For a button that opens a menu (`aria-haspopup`).
  hasPopup?: 'menu'
  // Focuses the button on mount: a dialog's safe default (Cancel).
  autoFocus?: boolean
}

const variants = {
  primary: 'bg-accent text-accent-ink font-semibold hover:bg-accent-hover',
  secondary: 'border border-line-strong bg-control hover:bg-control-hover',
  dashed: 'border border-dashed border-line-dashed bg-row-hover text-text-soft hover:border-accent',
  blocked: 'bg-line-strong font-semibold text-faint',
  danger: 'bg-error text-error-ink font-semibold hover:bg-error-soft'
}

const sizes = {
  md: 'h-[30px] px-3 rounded-control gap-1.5',
  sm: 'h-[26px] px-2.5 rounded-control-sm gap-1 text-small'
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  disabledReason,
  expanded,
  hasPopup,
  autoFocus = false
}: ButtonProps) {
  const inactive = disabled || loading
  return (
    <button
      type="button"
      onClick={inactive ? undefined : onClick}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-expanded={expanded}
      aria-haspopup={hasPopup}
      autoFocus={autoFocus}
      title={disabled ? disabledReason : undefined}
      className={cx(
        'inline-flex shrink-0 cursor-pointer items-center whitespace-nowrap',
        sizes[size],
        disabled ? 'cursor-not-allowed bg-disabled font-semibold text-faint' : variants[variant],
        loading && 'cursor-progress'
      )}
    >
      {loading ? (
        <Icon name="progress_activity" size={size === 'sm' ? 16 : 17} spin />
      ) : (
        icon && <Icon name={icon} size={size === 'sm' ? 16 : 17} />
      )}
      {children}
    </button>
  )
}
