import { cx } from './cx'
import { Icon } from './Icon'

interface PadButtonProps {
  // Accessible name, e.g. "OK" or "Play/pause".
  label: string
  icon?: string
  // Shown instead of an icon (the D-pad's OK).
  text?: string
  shape?: 'round' | 'wide'
  size?: 'md' | 'lg'
  // Lit for a moment after a press, from the pad or the keyboard.
  flash?: boolean
  disabled?: boolean
  // Every disabled key says why (tooltip).
  disabledReason?: string
  onPress: () => void
}

// A remote key: the D-pad, OK and the media and navigation keys of Remote & Screen.
export function PadButton({
  label,
  icon,
  text,
  shape = 'round',
  size = 'md',
  flash = false,
  disabled = false,
  disabledReason,
  onPress
}: PadButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={disabled ? disabledReason : label}
      disabled={disabled}
      data-flash={flash || undefined}
      // A click keeps the focus where it was, so the keyboard's remote keeps working after it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={disabled ? undefined : onPress}
      className={cx(
        'grid shrink-0 place-items-center border transition-colors duration-150',
        shape === 'round' ? 'rounded-full' : 'rounded-control px-3',
        size === 'lg' ? 'size-[64px]' : shape === 'round' ? 'size-[44px]' : 'h-[36px] min-w-[64px]',
        disabled
          ? 'cursor-not-allowed border-line bg-disabled text-dim'
          : flash
            ? 'cursor-pointer border-accent-line bg-accent/20 text-accent-bright'
            : 'cursor-pointer border-line-strong bg-control text-text-soft hover:bg-control-hover hover:text-text'
      )}
    >
      {icon ? (
        <Icon name={icon} size={size === 'lg' ? 26 : 20} />
      ) : (
        <span className="text-small font-semibold">{text}</span>
      )}
    </button>
  )
}
