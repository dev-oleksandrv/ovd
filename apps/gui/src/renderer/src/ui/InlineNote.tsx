import { Icon } from './Icon'

interface InlineNoteProps {
  title: string
  body: string
}

// Something in progress the user should know about, not an error: the Logs screen's
// "Reconnecting to …" while the device is away.
export function InlineNote({ title, body }: InlineNoteProps) {
  return (
    <div
      role="status"
      className="flex gap-2.5 rounded-tile border border-info/35 bg-info/7 px-3.5 py-3"
    >
      <Icon name="sync" size={18} className="text-info" />
      <div className="flex flex-col gap-1">
        <div className="font-semibold text-info">{title}</div>
        <div className="leading-normal whitespace-pre-line text-text-soft">{body}</div>
      </div>
    </div>
  )
}
