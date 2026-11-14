import { useEffect, useRef, useState } from 'react'
import { Button } from '../../ui/Button'
import { TextField } from '../../ui/TextField'
import { LEVELS, MAX_PROCESS_RATE, parseRateValue } from './logsView'

interface ProcessMenuProps {
  // The row's process (its syslog identity), shown as plain text.
  identity: string
  // Where the menu opens, in window coordinates.
  x: number
  y: number
  onMute: () => void
  onLevel: (level: string) => void
  onLimit: (rate: number) => void
  onClose: () => void
}

const ITEM =
  'flex w-full cursor-pointer items-center rounded-control-sm px-2.5 py-1.5 text-left text-small hover:bg-control-hover'

// The menu on a row's process (F31): Mute, "Level for…" and "Limit…". Rules apply on this
// computer to the lines of that process (the device's own settings are never touched).
export function ProcessMenu({
  identity,
  x,
  y,
  onMute,
  onLevel,
  onLimit,
  onClose
}: ProcessMenuProps) {
  const [mode, setMode] = useState<'root' | 'level' | 'limit'>('root')
  const [rate, setRate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const onDown = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const applyLimit = (): void => {
    const parsed = parseRateValue(rate)
    if (!parsed.ok) return setError(parsed.error)
    onLimit(parsed.value)
    onClose()
  }

  return (
    <div
      ref={root}
      role="menu"
      aria-label={`Process ${identity}`}
      style={{ left: x, top: y }}
      className="fixed z-20 flex w-[260px] animate-enter flex-col gap-0.5 rounded-card border border-line-strong bg-raised p-1.5 shadow-popover"
    >
      <div className="truncate px-2.5 py-1 font-mono text-label text-muted" title={identity}>
        {identity}
      </div>
      {mode === 'root' && (
        <>
          <button
            type="button"
            role="menuitem"
            className={ITEM}
            onClick={() => {
              onMute()
              onClose()
            }}
          >
            {`Mute ${identity}`}
          </button>
          <button type="button" role="menuitem" className={ITEM} onClick={() => setMode('level')}>
            {`Level for ${identity}…`}
          </button>
          <button type="button" role="menuitem" className={ITEM} onClick={() => setMode('limit')}>
            {`Limit ${identity}…`}
          </button>
        </>
      )}
      {mode === 'level' &&
        LEVELS.map((level) => (
          <button
            key={level.id}
            type="button"
            role="menuitem"
            className={ITEM}
            onClick={() => {
              onLevel(level.label)
              onClose()
            }}
          >
            {`${level.title} and above`}
          </button>
        ))}
      {mode === 'limit' && (
        <div className="flex flex-col gap-1.5 px-1.5 py-1">
          <div className="flex items-center gap-1.5">
            <TextField
              label="Lines per second"
              value={rate}
              onChange={(value) => {
                setRate(value)
                setError(null)
              }}
              onEnter={applyLimit}
              autoFocus
            />
            <Button size="sm" variant="primary" onClick={applyLimit}>
              Limit
            </Button>
          </div>
          <div className="text-label text-muted">
            Lines per second, 1 to {MAX_PROCESS_RATE}. The rest are hidden and counted.
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
