import type { Device, ProjectMode } from '@ovd/core'
import { watchDisabledReason, watchLabel, watchVisible } from '../run/watchView'
import { ToggleButton } from '../ui/ToggleButton'

interface WatchToggleProps {
  mode: ProjectMode | null
  target: Device | undefined
  watching: boolean
  onToggle: () => void
}

// The title bar's Watch (Stage 3.5), next to Run: only with a project folder open. Turning it on
// needs an online target; while watching it can always be turned off.
export function WatchToggle({ mode, target, watching, onToggle }: WatchToggleProps) {
  if (!watchVisible(mode)) return null
  const reason = watchDisabledReason(target, watching)
  return (
    <ToggleButton
      icon="visibility"
      pressed={watching}
      onChange={onToggle}
      disabled={reason !== null}
      {...(reason === null ? {} : { disabledReason: reason })}
    >
      {watchLabel(watching)}
    </ToggleButton>
  )
}
