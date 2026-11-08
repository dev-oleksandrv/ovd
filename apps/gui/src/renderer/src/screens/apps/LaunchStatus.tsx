import { Icon } from '../../ui/Icon'
import { LaunchCallout } from './LaunchCallout'
import type { LaunchOutcome } from './launchOutcomes'

interface LaunchStatusProps {
  outcome: LaunchOutcome | undefined
  now: Date
}

// The detail's launch state: "Verifying launch…" while core watches the app, then the callout
// of a launch that wasn't verified. Nothing for a verified launch: the status pill says it.
export function LaunchStatus({ outcome, now }: LaunchStatusProps) {
  if (!outcome) return null
  if (outcome.state === 'verifying') {
    return (
      <div role="status" className="flex items-center gap-2 text-small text-info">
        <Icon name="progress_activity" size={16} spin />
        Verifying launch…
      </div>
    )
  }
  return <LaunchCallout outcome={outcome} now={now} />
}
