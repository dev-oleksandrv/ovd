import { Icon } from './Icon'

interface InlineErrorProps {
  title: string
  // What to do next; every error carries a fix.
  body: string
}

// An error inside a dialog step, above the action that retries it.
export function InlineError({ title, body }: InlineErrorProps) {
  return (
    <div
      role="alert"
      className="flex gap-2.5 rounded-tile border border-error/35 bg-error/7 px-3.5 py-3"
    >
      <Icon name="error" size={18} className="text-error" />
      <div className="flex flex-col gap-1">
        <div className="font-semibold text-error-soft">{title}</div>
        <div className="leading-normal text-text-soft">{body}</div>
      </div>
    </div>
  )
}
