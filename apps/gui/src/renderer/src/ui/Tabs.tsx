import { cx } from './cx'
import { Badge } from './Badge'

export interface TabItem<Id extends string> {
  id: Id
  label: string
  badge?: string | number
  badgeTone?: 'error' | 'warning' | 'accent'
}

interface TabsProps<Id extends string> {
  items: Array<TabItem<Id>>
  value: Id
  onChange: (id: Id) => void
}

export function Tabs<Id extends string>({ items, value, onChange }: TabsProps<Id>) {
  return (
    <div role="tablist" className="flex flex-wrap gap-0.5">
      {items.map((tab) => {
        const selected = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cx(
              'flex cursor-pointer items-center gap-2 border-b-2 px-3 py-2 font-medium whitespace-nowrap',
              selected ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
            )}
          >
            {tab.label}
            {tab.badge !== undefined && <Badge tone={tab.badgeTone}>{tab.badge}</Badge>}
          </button>
        )
      })}
    </div>
  )
}
