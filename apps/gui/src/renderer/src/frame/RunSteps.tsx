import { Button } from '../ui/Button'
import { CommandLine } from '../ui/CommandLine'
import { cx } from '../ui/cx'
import { Icon } from '../ui/Icon'
import type { RunRowStatus, RunState } from '../run/runView'

interface RunStepsProps {
  state: Exclude<RunState, { phase: 'idle' }>
  // The run's CLI equivalent (ADR 0005), shown as the panel's last line.
  cli: string
  onOpenLogs: () => void
}

const ICONS: Record<RunRowStatus, { name: string; className: string; spin?: true }> = {
  pending: { name: 'radio_button_unchecked', className: 'text-dim' },
  active: { name: 'progress_activity', className: 'text-info', spin: true },
  done: { name: 'check_circle', className: 'text-accent' },
  failed: { name: 'error', className: 'text-error' },
  skipped: { name: 'do_not_disturb_on', className: 'text-muted' }
}

const STATUS_TEXT: Record<RunRowStatus, string> = {
  pending: 'pending',
  active: 'in progress',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped'
}

// The Run dropdown's panel (`RunButton` places it): the six steps of a run as they go, the crash of a launch that wasn't
// verified, and the CLI echo.
export function RunSteps({ state, cli, onOpenLogs }: RunStepsProps) {
  return (
    <div
      role="region"
      aria-label="Run steps"
      className="flex w-[360px] animate-enter flex-col gap-2 rounded-card border border-line-strong bg-raised p-3 shadow-popover"
    >
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {state.rows.map((row) => {
          const icon = ICONS[row.status]
          return (
            <li
              key={row.id}
              aria-label={`${row.label}: ${STATUS_TEXT[row.status]}`}
              className="flex items-start gap-2.5"
            >
              <Icon
                name={icon.name}
                size={17}
                {...(icon.spin ? { spin: true } : {})}
                className={icon.className}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span
                  className={cx(
                    row.status === 'pending' ? 'text-faint' : 'text-text',
                    row.status === 'failed' && 'text-error-soft'
                  )}
                >
                  {row.label}
                </span>
                {row.detail && (
                  <span
                    className={cx(
                      'font-mono text-label wrap-anywhere',
                      row.status === 'failed' ? 'text-error-text' : 'text-muted'
                    )}
                  >
                    {row.detail}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ol>
      {state.phase === 'failed' && state.error && (
        <div className="text-small text-muted">{state.error.hint}</div>
      )}
      <CommandLine command={cli} />
      {state.phase !== 'running' && (
        <div className="flex justify-end">
          <Button size="sm" icon="subject" onClick={onOpenLogs}>
            Open Logs
          </Button>
        </div>
      )}
    </div>
  )
}
