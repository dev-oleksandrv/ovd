import type { Device, ProjectMode } from '@ovd/core'
import { useEffect, useRef, useState } from 'react'
import { runCli, runDisabledReason, runLabel, type RunState } from '../run/runView'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { RunSteps } from './RunSteps'

interface RunButtonProps {
  mode: ProjectMode | null
  target: Device | undefined
  state: RunState
  onRun: (device: string) => void
  onOpenLogs: () => void
}

// The title bar's Run ▸ <project | .vpkg> (Stage 3.4). A click starts the run and opens its
// steps; the chevron shows the last run's steps again. Disabled, it says why (gui rules). Esc
// or a click outside closes the steps, as the target picker does.
export function RunButton({ mode, target, state, onRun, onOpenLogs }: RunButtonProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const reason = runDisabledReason(mode, target, state.phase === 'running')

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
    <div ref={root} className="relative flex flex-none items-center gap-0.5">
      <Button
        variant="primary"
        icon="play_arrow"
        disabled={reason !== null}
        {...(reason === null ? {} : { disabledReason: reason })}
        onClick={() => {
          if (!target) return
          setOpen(true)
          onRun(target.id)
        }}
      >
        {runLabel(mode)}
      </Button>
      {state.phase !== 'idle' && (
        <IconButton
          icon={open ? 'expand_less' : 'expand_more'}
          label={open ? 'Hide run steps' : 'Show run steps'}
          onClick={() => setOpen((was) => !was)}
        />
      )}
      {open && state.phase !== 'idle' && (
        <div className="absolute top-9 left-0">
          <RunSteps
            state={state}
            cli={runCli(state.device)}
            onOpenLogs={() => {
              setOpen(false)
              onOpenLogs()
            }}
          />
        </div>
      )}
    </div>
  )
}
