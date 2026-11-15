import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LogsFilter } from '../../../../preload/api'
import { Button } from '../../ui/Button'
import { Select } from '../../ui/Select'
import { TextField } from '../../ui/TextField'
import {
  LOG_FACILITIES,
  parseBootValue,
  parseNumberValue,
  parseWordValue,
  type Parsed
} from './logsView'

interface FiltersPopoverProps {
  filter: LogsFilter
  onChange: (change: (filter: LogsFilter) => LogsFilter) => void
}

type Field = 'pid' | 'tid' | 'tag' | 'identity'

// A value added to one of the filter's lists, once.
function added<T extends string | number>(list: T[] | undefined, value: T): T[] {
  return list?.includes(value) ? list : [...(list ?? []), value]
}

// Space kept between the popover and the window's edge.
const EDGE = 8

const FACILITY_OPTIONS = [
  { value: '', label: 'Facility…' },
  ...LOG_FACILITIES.map((facility) => ({ value: facility, label: facility }))
]

// "Filters": PID, TID, tag, identity, facility and boot. Values within one field combine with
// OR, different fields with AND (the CLI's rule); the active ones show as chips on the screen.
export function FiltersPopover({ filter, onChange }: FiltersPopoverProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const [text, setText] = useState<Record<Field | 'boot', string>>({
    pid: '',
    tid: '',
    tag: '',
    identity: '',
    boot: ''
  })
  const [error, setError] = useState<string | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  // Where the popover starts, from the button's left edge: 0, or less to stay in the window.
  const [left, setLeft] = useState(0)

  // The popover opens in line with the button but must stay in the window. In a window narrower
  // than the default it ran past the right edge: its Add buttons were out of reach, typing in a
  // field scrolled the screen sideways, and the next click outside was lost, because the screen
  // jumped back as the popover closed. Measured before paint after every render while it is
  // open (the button moves when the toolbar wraps: a longer package list, the regex error) and
  // when the window is resized.
  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const anchor = root.current?.getBoundingClientRect()
      const box = panel.current?.getBoundingClientRect()
      if (!anchor || !box) return
      const fit = Math.max(EDGE, Math.min(anchor.left, window.innerWidth - box.width - EDGE))
      setLeft(fit - anchor.left)
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  })

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

  const active =
    (filter.pid?.length ?? 0) +
    (filter.tid?.length ?? 0) +
    (filter.tag?.length ?? 0) +
    (filter.identity?.length ?? 0) +
    (filter.facility?.length ?? 0) +
    (filter.boot?.length ?? 0)

  const set = (field: Field | 'boot', value: string): void => {
    setText((was) => ({ ...was, [field]: value }))
    setError(null)
  }

  const addValue = (field: Field): void => {
    const raw = text[field]
    if (field === 'pid' || field === 'tid') {
      const parsed = parseNumberValue(raw, field === 'pid' ? 'A PID' : 'A TID')
      if (!parsed.ok) return setError(parsed.error)
      onChange((f) => ({ ...f, [field]: added(f[field], parsed.value) }))
    } else {
      const parsed = parseWordValue(raw, field === 'tag' ? 'A tag' : 'An identity')
      if (!parsed.ok) return setError(parsed.error)
      onChange((f) => ({ ...f, [field]: added(f[field], parsed.value) }))
    }
    set(field, '')
  }

  const addBoot = (parsed: Parsed<string>): void => {
    if (!parsed.ok) return setError(parsed.error)
    onChange((f) => ({ ...f, boot: added(f.boot, parsed.value) }))
    set('boot', '')
  }

  const row = (field: Field, label: string) => (
    <div className="flex items-center gap-1.5">
      <span className="w-[68px] shrink-0 text-small text-muted">{label}</span>
      <TextField
        label={label}
        value={text[field]}
        onChange={(value) => set(field, value)}
        onEnter={() => addValue(field)}
      />
      <Button size="sm" onClick={() => addValue(field)}>
        {`Add ${label}`}
      </Button>
    </div>
  )

  return (
    <div ref={root} className="relative flex-none">
      <Button
        size="sm"
        icon="filter_list"
        hasPopup="menu"
        expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {active > 0 ? `Filters (${active})` : 'Filters'}
      </Button>
      {open && (
        <div
          ref={panel}
          role="group"
          aria-label="Filter by process, thread, tag, identity, facility or boot"
          style={{ left }}
          className="absolute top-full z-10 mt-1 flex w-[460px] animate-enter flex-col gap-2 rounded-card border border-line-strong bg-raised p-3 shadow-popover"
        >
          {row('pid', 'PID')}
          {row('tid', 'TID')}
          {row('tag', 'Tag')}
          {row('identity', 'Identity')}
          <div className="flex items-center gap-1.5">
            <span className="w-[68px] shrink-0 text-small text-muted">Facility</span>
            <Select
              label="Facility"
              options={FACILITY_OPTIONS}
              value=""
              onChange={(value) => {
                if (value !== '') onChange((f) => ({ ...f, facility: added(f.facility, value) }))
              }}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-[68px] shrink-0 text-small text-muted">Boot</span>
            <TextField
              label="Boot ID"
              value={text.boot}
              onChange={(value) => set('boot', value)}
              onEnter={() => addBoot(parseBootValue(text.boot))}
            />
            <Button size="sm" onClick={() => addBoot(parseBootValue(text.boot))}>
              Add boot
            </Button>
            <Button size="sm" onClick={() => addBoot({ ok: true, value: 'current' })}>
              This boot
            </Button>
          </div>
          {error && (
            <div role="alert" className="text-label text-error">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
