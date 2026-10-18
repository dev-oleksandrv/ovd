import { cx } from './cx'
import { Icon } from './Icon'

interface IconButtonProps {
  icon: string
  label: string
  onClick?: () => void
  disabled?: boolean
  size?: number
}

export function IconButton({ icon, label, onClick, disabled = false, size = 20 }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cx(
        'grid size-[30px] shrink-0 place-items-center rounded-control',
        disabled
          ? 'cursor-not-allowed text-faint'
          : 'cursor-pointer text-muted hover:bg-control-hover hover:text-text'
      )}
    >
      <Icon name={icon} size={size} />
    </button>
  )
}
