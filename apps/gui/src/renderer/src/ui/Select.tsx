export interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  // Accessible name, e.g. "Package".
  label: string
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
}

// A labelled native select (the Logs package filter): the platform draws the menu.
export function Select({ label, options, value, onChange }: SelectProps) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-[30px] max-w-[260px] min-w-0 cursor-pointer rounded-control border border-line-strong bg-input px-2 text-small text-text outline-none focus:border-accent-line"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
