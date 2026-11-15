import type { PackageValidation, ValidationIssue } from '@ovd/core'
import { Button } from '../../ui/Button'
import { ErrorState } from '../../ui/ErrorState'
import { Icon } from '../../ui/Icon'
import { LoadingState } from '../../ui/LoadingState'
import { Table, type Column } from '../../ui/Table'
import { IssueText } from './IssueText'
import { issueLine, locationText, summaryText, type Load } from './packageTabsView'
import { SeverityLabel } from './SeverityLabel'

interface ValidateTabProps {
  file: string
  validation: Load<PackageValidation> | undefined
  revalidating: boolean
  onRevalidate: () => void
  onRetry: () => void
  // Opens Manifest at that line.
  onOpenLine: (line: number) => void
}

// Packages → Validate (Stage 5.3): `vpt validate` as a table; a location with a line opens it in
// Manifest, since the lines are the packaged manifest's (ARCHITECTURE §8).
export function ValidateTab({
  file,
  validation,
  revalidating,
  onRevalidate,
  onRetry,
  onOpenLine
}: ValidateTabProps) {
  if (validation === undefined || validation.status === 'loading') {
    return <LoadingState label={`Validating ${file}…`} />
  }
  if (validation.status === 'error') {
    return (
      <ErrorState
        title={validation.error.message}
        hint={validation.error.hint}
        actions={<Button onClick={onRetry}>Retry</Button>}
      />
    )
  }
  const v = validation.data
  const columns: Column<ValidationIssue>[] = [
    {
      key: 'severity',
      header: 'Severity',
      width: '90px',
      render: (issue) => <SeverityLabel severity={issue.severity} />
    },
    {
      key: 'message',
      header: 'Message',
      width: 'minmax(0,1fr)',
      render: (issue) => <IssueText issue={issue} />
    },
    {
      key: 'file',
      header: 'File',
      width: '170px',
      render: (issue) => {
        const line = issueLine(issue)
        const text = locationText(issue)
        return line === undefined ? (
          <span className="font-mono text-small text-muted">{text}</span>
        ) : (
          <button
            type="button"
            onClick={() => onOpenLine(line)}
            title={`Open line ${line} in Manifest`}
            className="cursor-pointer font-mono text-small text-accent hover:underline"
          >
            {text}
          </button>
        )
      }
    }
  ]
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <Icon
          name={v.valid ? 'check_circle' : 'error'}
          size={20}
          className={v.valid ? 'text-accent' : 'text-error'}
        />
        <div className="flex-1 font-semibold" role="status">
          {summaryText(v)}
        </div>
        <Button size="sm" icon="refresh" onClick={onRevalidate} loading={revalidating}>
          Validate again
        </Button>
      </div>
      {v.issues.length > 0 && (
        <div className="-mx-6">
          <Table
            columns={columns}
            rows={v.issues}
            rowKey={(issue) => String(v.issues.indexOf(issue))}
          />
        </div>
      )}
    </div>
  )
}
