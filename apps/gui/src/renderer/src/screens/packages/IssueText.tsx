import type { ValidationIssue } from '@ovd/core'
import { issueText } from './packageTabsView'

// An issue's `[key] message` and its help, as plain text: vpt quotes manifest values, and the
// manifest is a file anyone can write.
export function IssueText({ issue }: { issue: ValidationIssue }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="break-words">{issueText(issue)}</div>
      {issue.help && (
        <div className="text-small break-words whitespace-pre-line text-muted">{issue.help}</div>
      )}
    </div>
  )
}
