import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'
import { Icon } from './Icon'

export interface MenuItem {
  id: string
  label: string
  icon?: string
  onSelect: () => void
}

interface MenuButtonProps {
  // The button's text; also the menu's accessible name.
  label: string
  icon?: string
  size?: 'md' | 'sm'
  items: MenuItem[]
}

// A button that opens a small menu of actions below it (the Logs toolbar's Export). Esc, a
// click outside or a choice closes it, as the title bar's target picker does.
export function MenuButton({ label, icon, size = 'md', items }: MenuButtonProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onDown = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [open])

  return (
    <div ref={root} className="relative flex-none">
      <Button
        size={size}
        {...(icon === undefined ? {} : { icon })}
        hasPopup="menu"
        expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {label}
      </Button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute top-full right-0 z-10 mt-1 flex min-w-[200px] animate-enter flex-col gap-0.5 rounded-card border border-line-strong bg-raised p-1.5 shadow-popover"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className="flex cursor-pointer items-center gap-2 rounded-control p-2 text-left whitespace-nowrap text-text-soft hover:bg-control-hover"
            >
              {item.icon && <Icon name={item.icon} />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
