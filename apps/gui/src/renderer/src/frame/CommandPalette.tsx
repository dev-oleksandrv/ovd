import { useState, type KeyboardEvent } from 'react'
import { filterItems, type PaletteItem } from '../shell/paletteItems'
import { cx } from '../ui/cx'
import { Icon } from '../ui/Icon'

interface CommandPaletteProps {
  items: PaletteItem[]
  onClose: () => void
}

export function CommandPalette({ items, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const shown = filterItems(items, query)

  const run = (item: PaletteItem | undefined): void => {
    if (!item) return
    onClose()
    item.run()
  }

  const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected((i) => Math.min(shown.length - 1, i + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected((i) => Math.max(0, i - 1))
    } else if (event.key === 'Enter') {
      run(shown[selected])
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-100 flex justify-center bg-backdrop pt-[12vh]"
    >
      <div
        role="dialog"
        aria-modal
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[460px] w-[600px] max-w-[calc(100vw-32px)] shrink-0 animate-enter flex-col self-start overflow-hidden rounded-palette border border-line-strong bg-raised shadow-modal"
      >
        <div className="flex items-center gap-2.5 border-b border-line-menu px-4">
          <Icon name="search" size={20} className="text-muted" />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="palette-items"
            aria-label="Command"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSelected(0)
            }}
            onKeyDown={onKey}
            placeholder="Go to a screen or run an action…"
            className="h-[50px] min-w-0 flex-1 border-none bg-transparent text-lead outline-none"
          />
          <div className="font-mono text-label text-faint">esc</div>
        </div>
        <div id="palette-items" role="listbox" className="overflow-auto p-1.5">
          {shown.map((item, index) => (
            <div
              key={item.label}
              role="option"
              aria-selected={index === selected}
              onClick={() => run(item)}
              onMouseMove={() => setSelected(index)}
              className={cx(
                'flex cursor-pointer items-center gap-3 rounded-control px-2.5 py-[9px]',
                index === selected && 'bg-control-hover'
              )}
            >
              <Icon name={item.icon} className="text-muted" />
              <div className={cx('flex-1', item.later ? 'text-faint' : 'text-text')}>
                {item.label}
              </div>
              <div className="text-meta text-faint">{item.kind}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
