import { cx } from './cx'

interface IconProps {
  name: string
  size?: number
  fill?: boolean
  spin?: boolean
  className?: string
}

// Material Symbols Rounded glyph, sized like the design (square box, no line-height slack).
export function Icon({ name, size = 18, fill = false, spin = false, className }: IconProps) {
  return (
    <span
      aria-hidden
      className={cx(
        'material-symbols-rounded shrink-0 overflow-hidden leading-none select-none',
        spin && 'animate-spin',
        className
      )}
      style={{ fontSize: size, width: size, fontVariationSettings: `'FILL' ${fill ? 1 : 0}` }}
    >
      {name}
    </span>
  )
}
