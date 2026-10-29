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
}

// A first-run card: icon, name, detail, and while failing its fix and Re-check.
export function FirstRunCheck({ check, highlighted, onRecheck }: FirstRunCheckProps) {
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
        {!ok && !waiting && (
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
