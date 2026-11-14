import type { LogsFilter } from '../../../../preload/api'
import { filterChips } from './logsView'
import { RemovableChip } from './RemovableChip'

interface FilterChipsProps {
  filter: LogsFilter
  onChange: (change: (filter: LogsFilter) => LogsFilter) => void
}

// The advanced filters in use (PID, TID, tag, identity, facility, boot), each removable.
export function FilterChips({ filter, onChange }: FilterChipsProps) {
  const chips = filterChips(filter)
  if (chips.length === 0) return null
  return (
    <div role="group" aria-label="Active filters" className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <RemovableChip key={chip.id} label={chip.label} onRemove={() => onChange(chip.remove)} />
      ))}
    </div>
  )
}
