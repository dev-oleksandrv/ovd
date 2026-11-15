import type { PackageManifestFile, PackageValidation } from '@ovd/core'
import { useEffect, useRef } from 'react'
import { Button } from '../../ui/Button'
import { cx } from '../../ui/cx'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorState } from '../../ui/ErrorState'
import { InlineError } from '../../ui/InlineError'
import { LoadingState } from '../../ui/LoadingState'
import { toneBorder } from '../../ui/tone'
import { IssueText } from './IssueText'
import { manifestNotes, severityTone, worstSeverity, type Load } from './packageTabsView'
import { SeverityLabel } from './SeverityLabel'

interface ManifestTabProps {
  file: string
  manifest: Load<PackageManifestFile> | undefined
  validation: Load<PackageValidation> | undefined
  // The line Validate opened: scrolled to and highlighted.
  focusLine: number | null
  onRetry: () => void
  onRetryValidation: () => void
}

// Packages → Manifest (Stage 5.3): `vpt dump <pkg> manifest.toml` with line numbers, and
// `vpt validate`'s notes under the lines they point at.
export function ManifestTab({
  file,
  manifest,
  validation,
  focusLine,
  onRetry,
  onRetryValidation
}: ManifestTabProps) {
  const focused = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // jsdom has no scrollIntoView.
    focused.current?.scrollIntoView?.({ block: 'center' })
  }, [focusLine, manifest?.status])

  if (manifest === undefined || manifest.status === 'loading') {
    return <LoadingState label={`Reading manifest.toml from ${file}…`} />
  }
  if (manifest.status === 'error') {
    return (
      <ErrorState
        title={manifest.error.message}
        hint={manifest.error.hint}
        actions={<Button onClick={onRetry}>Retry</Button>}
      />
    )
  }
  const { lines } = manifest.data
  if (lines.length === 0) {
    return (
      <EmptyState
        title="manifest.toml is empty"
        body={`${file} holds an empty manifest.toml. Fix the project’s manifest and build again.`}
        actions={<Button onClick={onRetry}>Read again</Button>}
      />
    )
  }
  const v = validation?.status === 'ready' ? validation.data : undefined
  const { byLine, unlocated } = manifestNotes(v)
  const width = `${String(lines.length).length + 1}ch`
  return (
    <div className="flex flex-col gap-3">
      {validation?.status === 'loading' && (
        <div role="status" className="text-small text-muted">
          Validating {file}…
        </div>
      )}
      {validation?.status === 'error' && (
        <InlineError title="Couldn’t validate the package" body={validation.error.hint}>
          <div>
            <Button size="sm" onClick={onRetryValidation}>
              Retry
            </Button>
          </div>
        </InlineError>
      )}
      {unlocated.length > 0 && (
        <ul aria-label="Notes without a line" className="m-0 flex flex-col gap-2 p-0">
          {unlocated.map((issue, index) => (
            <li
              key={index}
              className={cx(
                'flex list-none gap-2.5 rounded-tile border-l-2 bg-panel px-3 py-2',
                toneBorder[severityTone(issue.severity)]
              )}
            >
              <SeverityLabel severity={issue.severity} />
              <IssueText issue={issue} />
            </li>
          ))}
        </ul>
      )}
      <div
        role="list"
        aria-label="manifest.toml"
        className="overflow-auto rounded-card border border-line bg-panel py-2 font-mono text-small leading-relaxed"
      >
        {lines.map((text, index) => {
          const n = index + 1
          const notes = byLine.get(n) ?? []
          const worst = worstSeverity(notes)
          const isFocus = n === focusLine
          return (
            <div
              key={n}
              role="listitem"
              aria-label={`Line ${n}`}
              aria-current={isFocus ? 'true' : undefined}
              ref={isFocus ? focused : undefined}
              className={cx(
                'border-l-2',
                worst ? toneBorder[severityTone(worst)] : 'border-l-transparent',
                isFocus && 'bg-selected'
              )}
            >
              <div className="flex">
                <span
                  style={{ width }}
                  className="flex-none pr-3 text-right text-faint select-none"
                >
                  {n}
                </span>
                <span className="pr-3 whitespace-pre text-text-soft">{text}</span>
              </div>
              {notes.map((issue, i) => (
                <div
                  key={i}
                  style={{ paddingLeft: `calc(${width} + 0.75rem)` }}
                  className="flex gap-2 py-1 pr-3 font-sans text-compact"
                >
                  <SeverityLabel severity={issue.severity} />
                  <IssueText issue={issue} />
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
