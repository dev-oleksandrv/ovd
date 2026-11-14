import type { Crash } from '@ovd/core'
import { Button } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { InlineError } from '../../ui/InlineError'
import { KeyValueGrid } from '../../ui/KeyValueGrid'
import { crashSummary, detailRows, kindLabel, NO_STACK } from './crashesView'
import { useCrashActions } from './useCrashActions'
import { useCrashDetail } from './useCrashDetail'

interface CrashDetailPanelProps {
  crash: Crash
  device: string
  now: Date
  // Logs, filtered to the crash's app, at the crash's time.
  onOpenLogs: (crash: Crash) => void
}

// The right-hand panel: one report with its raw stack and the actions on it. The stack is
// plain text in a <pre>: never HTML, never markdown, never auto-linked, whatever the app wrote.
export function CrashDetailPanel({ crash, device, now, onOpenLogs }: CrashDetailPanelProps) {
  const detail = useCrashDetail(device, crash.id)
  const actions = useCrashActions(device, crash.id)
  const busy = actions.busy !== null
  const stack = detail.status === 'ready' ? detail.detail.stack : []
  const reason = detail.status === 'ready' ? detail.detail.reason : undefined

  return (
    <aside
      aria-label={`Crash ${crash.id} details`}
      className="flex min-h-0 flex-col gap-4 overflow-auto border-l border-line bg-sunken p-5"
    >
      <div className="flex flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <Chip mono>{kindLabel(crash.kind)}</Chip>
          <h2 className="m-0 truncate font-mono text-title font-semibold">{crash.package}</h2>
        </div>
        <div className="text-text-soft">{crashSummary(crash)}</div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          icon="download"
          variant="primary"
          loading={actions.busy === 'download'}
          disabled={busy && actions.busy !== 'download'}
          disabledReason="Another action is running"
          onClick={actions.download}
        >
          Download ACR
        </Button>
        <Button
          icon="content_copy"
          loading={actions.busy === 'copy-path'}
          disabled={busy && actions.busy !== 'copy-path'}
          disabledReason="Another action is running"
          onClick={actions.copyPath}
        >
          Copy crash report path
        </Button>
        <Button
          icon="smart_toy"
          loading={actions.busy === 'copy-prompt'}
          disabled={busy && actions.busy !== 'copy-prompt'}
          disabledReason="Another action is running"
          onClick={actions.copyPrompt}
        >
          Copy prompt for your agent
        </Button>
        <Button icon="article" onClick={() => onOpenLogs(crash)}>
          Logs at crash time
        </Button>
        {actions.path !== null && (
          <Button icon="folder_open" onClick={actions.reveal}>
            Show in folder
          </Button>
        )}
      </div>

      <KeyValueGrid items={detailRows(crash, now)} />

      {detail.status === 'loading' ? (
        <div role="status" className="text-muted">
          Reading the report…
        </div>
      ) : detail.status === 'error' ? (
        <InlineError title={detail.error.message} body={detail.error.hint} />
      ) : (
        <section aria-label="Stack" className="flex flex-col gap-2">
          {reason !== undefined && (
            <div className="flex flex-col gap-1">
              <div className="text-label tracking-[.06em] text-subtle uppercase">Reason</div>
              <div className="font-mono text-small break-words text-text-soft">{reason}</div>
            </div>
          )}
          <div className="text-label tracking-[.06em] text-subtle uppercase">
            Stack · raw, as the app wrote it
          </div>
          {stack.length > 0 ? (
            <pre
              aria-label="Crash stack"
              className="m-0 overflow-auto rounded-field border border-line-soft bg-panel px-3.5 py-3 font-mono text-small leading-relaxed whitespace-pre text-text-soft"
            >
              {stack.join('\n')}
            </pre>
          ) : (
            <div className="text-small text-muted">{NO_STACK}</div>
          )}
        </section>
      )}
    </aside>
  )
}
