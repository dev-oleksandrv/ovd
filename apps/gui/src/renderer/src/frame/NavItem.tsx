import { Badge } from '../ui/Badge'
import { cx } from '../ui/cx'
import { Icon } from '../ui/Icon'

interface NavItemProps {
  label: string
  icon: string
  active?: boolean
  badge?: string
  badgeTone?: 'error' | 'warning' | 'accent'
  onClick: () => void
}

export function NavItem({ label, icon, active = false, badge, badgeTone, onClick }: NavItemProps) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cx(
        'flex h-8 cursor-pointer items-center gap-2.5 rounded-control px-2.5 text-left',
        active ? 'bg-selected text-text' : 'text-text-nav hover:bg-nav-hover hover:text-text'
      )}
    >
      <Icon name={icon} fill={active} />
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {badge && <Badge tone={badgeTone}>{badge}</Badge>}
    </button>
  )
}
