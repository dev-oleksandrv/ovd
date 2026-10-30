import type { Check } from '@ovd/core'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { Icon } from '../../ui/Icon'
import { passed } from './doctorView'

const INSTALL_URL = 'https://developer.amazon.com/docs/vega/0.24/'

interface FirstRunCheckProps {
  check: Check
  highlighted: boolean
  onRecheck: () => void
  // The Devices card's "Start the Virtual Device" (fix `start-vvd`).
  startVvd?: { detail: string; busy: boolean; onStart: () => void }
}

// A first-run card: icon, name, detail, and while failing its fix and Re-check.
export function FirstRunCheck({ check, highlighted, onRecheck, startVvd }: FirstRunCheckProps) {
  const ok = passed(check)
  const waiting = check.status === 'skipped'
  const install =
    check.fix === 'install-sdk'
      ? 'Install the Vega SDK ↗'
      : check.fix === 'install-cli'
        ? 'Install the Vega CLI ↗'
        : null
  return (
    <section
      aria-label={check.name}
      className={cx(
        'flex shrink-0 items-start gap-3 rounded-card border bg-panel px-4 py-3.5 transition-colors duration-300',
        highlighted ? 'border-warning/70' : 'border-line-soft'
      )}
    >
      <Icon
        name={ok ? 'check_circle' : waiting ? 'pending' : 'error'}
        size={20}
        fill
        className={ok ? 'text-accent' : waiting ? 'text-faint' : 'text-warning'}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <div className="font-semibold">{check.name}</div>
          <div className="text-compact text-muted">{check.detail}</div>
        </div>
        {!ok && !waiting && check.fix === 'start-vvd' && startVvd && (
          <>
            {/* "Set up a Fire TV stick" joins with its slice; until then the hint says how. */}
            {check.hint && <div className="text-compact text-muted">{check.hint}</div>}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5">
              <button
                type="button"
                aria-busy={startVvd.busy || undefined}
                onClick={startVvd.busy ? undefined : startVvd.onStart}
                className="flex cursor-pointer items-start gap-2.5 rounded-tile border border-line-menu bg-input px-3.5 py-3 text-left hover:border-accent-line hover:bg-row-hover"
              >
                <Icon
                  name={startVvd.busy ? 'progress_activity' : 'desktop_windows'}
                  size={20}
                  spin={startVvd.busy}
                  className="text-accent"
                />
                <span className="flex flex-col gap-[3px]">
                  <span className="font-semibold">Start the Virtual Device</span>
                  <span className="text-small leading-[1.4] text-muted">{startVvd.detail}</span>
                </span>
              </button>
            </div>
          </>
        )}
        {!ok && !waiting && !(check.fix === 'start-vvd' && startVvd) && (
          <>
            {check.hint && check.id === 'devices' && (
              <div className="text-compact text-muted">{check.hint}</div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {install && (
                <a
                  href={INSTALL_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-[30px] items-center gap-1.5 rounded-control bg-accent px-3 font-semibold text-accent-ink no-underline hover:bg-accent-hover"
                >
                  {install}
                </a>
              )}
              <Button icon="refresh" onClick={onRecheck}>
                Re-check
              </Button>
              {check.command && (
                <div className="font-mono text-label text-faint">{check.command}</div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
