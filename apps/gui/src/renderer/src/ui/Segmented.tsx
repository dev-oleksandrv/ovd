import { cx } from './cx'

export interface SegmentedOption<Id extends string> {
  id: Id
  label: string
  // Accessible name when the label is short (a level letter).
  title?: string
}

interface SegmentedProps<Id extends string> {
  // Accessible name of the group, e.g. "Level".
  label: string
  options: Array<SegmentedOption<Id>>
  value: Id
  onChange: (id: Id) => void
}

// A row of mutually exclusive options (the Logs level picker V/D/I/W/E).
export function Segmented<Id extends string>({
  label,
  options,
  value,
  onChange
}: SegmentedProps<Id>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 rounded-control border border-line-strong bg-input p-0.5"
    >
      {options.map((option) => {
        const selected = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.title ?? option.label}
            title={option.title}
            onClick={() => onChange(option.id)}
            className={cx(
              'h-[24px] min-w-[26px] cursor-pointer rounded-control-sm px-1.5 font-mono text-small',
              selected ? 'bg-selected text-text' : 'text-muted hover:text-text'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
