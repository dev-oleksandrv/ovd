import { useState } from 'react'
import { Button } from '../../ui/Button'
import { CodeBlock } from '../../ui/CodeBlock'
import { InlineError } from '../../ui/InlineError'
import { CALLOUT_TITLES, crashCauseLines } from './appsView'
import type { LaunchOutcome } from './launchOutcomes'

interface LaunchCalloutProps {
  outcome: Extract<LaunchOutcome, { state: 'crashed' | 'not-running' }>
  now: Date
  // Opens the crash's report in Crashes, by its vault index.
  onOpenCrash?: (id: number) => void
}

// The callout of a launch that wasn't verified: the crash's cause and, on demand, the device
// log lines OVD captured around it (`loggingctl log -f -o short_precise`, filtered).
export function LaunchCallout({ outcome, now, onOpenCrash }: LaunchCalloutProps) {
  const [open, setOpen] = useState(false)
  if (outcome.state === 'not-running') {
    return (
      <InlineError
        title={CALLOUT_TITLES['not-running']}
        body="Check the app with ovd apps info, then launch it again."
      />
    )
  }
  const { crash } = outcome
  const reportId = crash.id
  return (
    <InlineError title={CALLOUT_TITLES.crashed} body={crashCauseLines(crash, now).join('\n')}>
      <div className="flex flex-col gap-2 pt-1">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon="article" expanded={open} onClick={() => setOpen(!open)}>
            Logs around crash
          </Button>
          {reportId !== undefined && onOpenCrash && (
            <Button size="sm" icon="bug_report" onClick={() => onOpenCrash(reportId)}>
              Open crash report
            </Button>
          )}
        </div>
        {open &&
          (crash.logs.length > 0 ? (
            <CodeBlock title="loggingctl log -f -o short_precise" code={crash.logs.join('\n')} />
          ) : (
            <div className="text-small text-muted">No log lines were captured</div>
          ))}
      </div>
    </InlineError>
  )
}
