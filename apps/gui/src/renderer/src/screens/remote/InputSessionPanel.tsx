import type { InputState } from '../../../../preload/api'
import { Card } from '../../ui/Card'
import { Icon } from '../../ui/Icon'
import { StatusPill } from '../../ui/StatusPill'
import { backendLabel } from './remoteView'

// The open session: its backend and what was sent, newest first, each with its CLI equivalent.
export function InputSessionPanel({ state }: { state: InputState & { status: 'ready' } }) {
  const backend = state.backend
  return (
    <Card
      title="Input session"
      action={
        <StatusPill tone="ok">
          {backend ? backendLabel(backend) : 'Connected'}
          {state.target ? ` · ${state.target.name}` : ''}
        </StatusPill>
      }
    >
      {state.sent.length === 0 ? (
        <div className="px-3.5 py-3 text-muted">
          Nothing sent yet. Press a key or type some text.
        </div>
      ) : (
        <ul
          aria-label="Sent"
          className="m-0 flex max-h-[320px] list-none flex-col overflow-auto p-0"
        >
          {state.sent.map((entry, i) => (
            <li
              key={`${entry.time}-${i}`}
              className="flex items-start gap-2.5 border-b border-line-row px-3.5 py-2 last:border-b-0"
            >
              <Icon
                name={entry.ok ? 'check' : 'error'}
                size={16}
                className={entry.ok ? 'text-accent' : 'text-error'}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="truncate text-text-soft">
                  {entry.kind === 'press' ? 'Pressed' : 'Typed'} {entry.label}
                </div>
                <code className="truncate font-mono text-label text-faint">{entry.cli}</code>
                {entry.error && (
                  <div className="text-label text-error-soft">{entry.error.message}</div>
                )}
              </div>
              <time className="font-mono text-label text-faint" dateTime={entry.time}>
                {new Date(entry.time).toLocaleTimeString()}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
