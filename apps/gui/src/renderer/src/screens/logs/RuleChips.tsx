import type { LogsFilter } from '../../../../preload/api'
import { ruleChips } from './logsView'
import { RemovableChip } from './RemovableChip'

interface RuleChipsProps {
  filter: LogsFilter
  onChange: (change: (filter: LogsFilter) => LogsFilter) => void
}

// The per-process rules in use (muted, level, limit), each removable.
export function RuleChips({ filter, onChange }: RuleChipsProps) {
  const chips = ruleChips(filter)
  if (chips.length === 0) return null
  return (
    <div role="group" aria-label="Process rules" className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <RemovableChip key={chip.id} label={chip.label} onRemove={() => onChange(chip.remove)} />
      ))}
    </div>
  )
}
