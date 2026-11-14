import { Icon } from '../../ui/Icon'

interface RemovableChipProps {
  // Plain text: identities and tags come from the device.
  label: string
  onRemove: () => void
}

// An active filter value or rule, with a button that takes it off.
export function RemovableChip({ label, onRemove }: RemovableChipProps) {
  return (
    <span className="inline-flex max-w-[320px] items-center gap-1 rounded-chip border border-accent-line bg-accent/12 py-px pr-0.5 pl-2 text-small text-accent">
      <span className="truncate" title={label}>
        {label}
      </span>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        title={`Remove ${label}`}
        onClick={onRemove}
        className="grid size-4 shrink-0 cursor-pointer place-items-center rounded-chip text-accent hover:bg-control-hover"
      >
        <Icon name="close" size={14} />
      </button>
    </span>
  )
}
