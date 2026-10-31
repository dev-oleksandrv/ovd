import { cleanCode } from './setupView'

interface CodeFieldProps {
  value: string
  onChange: (code: string) => void
  onEnter: () => void
}

// The big code input of the design's step 3 (`setupCode`).
export function CodeField({ value, onChange, onEnter }: CodeFieldProps) {
  return (
    <input
      type="text"
      aria-label="Code from the TV"
      value={value}
      placeholder="ABC123"
      autoFocus
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => onChange(cleanCode(event.target.value))}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onEnter()
      }}
      className="h-[52px] max-w-[260px] rounded-tile border border-line-strong bg-input px-4 font-mono text-code tracking-[.25em] text-text outline-none focus:border-accent-line"
    />
  )
}
