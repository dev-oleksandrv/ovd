import { cx } from '../ui/cx'

// A labelled one-line input of the pairing address step.
interface AddressFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  onEnter: () => void
  invalid?: boolean
  autoFocus?: boolean
}

export function AddressField({
  label,
  value,
  onChange,
  onEnter,
  invalid = false,
  autoFocus = false
}: AddressFieldProps) {
  return (
    <label className="flex flex-col gap-[5px]">
      <span className="text-label text-subtle">{label}</span>
      <input
        type="text"
        value={value}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onEnter()
        }}
        className={cx(
          'h-[34px] min-w-0 rounded-control border bg-input px-2.5 font-mono text-text outline-none focus:border-accent-line',
          invalid ? 'border-error' : 'border-line-strong'
        )}
      />
    </label>
  )
}
