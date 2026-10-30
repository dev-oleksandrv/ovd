import { cx } from '../ui/cx'
import { Icon } from '../ui/Icon'

interface RouteOptionProps {
  icon: string
  title: string
  body: string
  selected: boolean
  onSelect: () => void
}

// One of the pairing routes on step 1 (design `rUsb` / `rTv`).
export function RouteOption({ icon, title, body, selected, onSelect }: RouteOptionProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cx(
        'flex cursor-pointer flex-col items-start gap-1.5 rounded-card border p-3.5 text-left',
        selected ? 'border-accent/50 bg-accent/8' : 'border-line-menu bg-input hover:bg-row-hover'
      )}
    >
      <Icon name={icon} size={22} className="text-accent" />
      <span className="font-semibold">{title}</span>
      <span className="text-small leading-normal text-muted">{body}</span>
    </button>
  )
}
