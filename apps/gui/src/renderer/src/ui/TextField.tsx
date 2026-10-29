interface TextFieldProps {
  // Accessible name; the field has no visible label in the design.
  label: string
  value: string
  onChange: (value: string) => void
  onEnter?: () => void
  onEscape?: () => void
  autoFocus?: boolean
}

// Single-line input, as the device detail's rename field.
export function TextField({
  label,
  value,
  onChange,
  onEnter,
  onEscape,
  autoFocus = false
}: TextFieldProps) {
  return (
    <input
      type="text"
      aria-label={label}
      value={value}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onEnter?.()
        if (event.key === 'Escape') onEscape?.()
      }}
      className="h-[34px] max-w-[320px] min-w-0 flex-[1_1_200px] rounded-control border border-line-strong bg-input px-2.5 text-title font-semibold text-text outline-none focus:border-accent-line"
    />
  )
}
