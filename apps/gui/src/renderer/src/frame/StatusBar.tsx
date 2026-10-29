import type { ReactNode } from 'react'
import { useFeedback } from '../feedback/feedbackContext'
import { Icon } from '../ui/Icon'

interface StatusBarProps {
  // SDK and target items; the CLI echo is always on the right.
  children?: ReactNode
}

export function StatusBar({ children }: StatusBarProps) {
  const { cli } = useFeedback()
  return (
    <div className="flex h-[26px] min-w-0 flex-none items-center gap-4 border-t border-line bg-chrome pr-2 pl-3 text-meta text-muted">
      {children}
      <div className="flex-1" />
      {cli && (
        <button
          type="button"
          title="Copy CLI equivalent"
          onClick={() => navigator.clipboard.writeText(cli)}
          className="flex h-5 max-w-[600px] min-w-0 cursor-pointer items-center gap-2 rounded-chip pr-1.5 pl-2 font-mono text-label text-muted hover:bg-control hover:text-text"
        >
          <span className="min-w-0 truncate">$ {cli}</span>
          <span className="flex flex-none items-center gap-[3px] font-sans text-accent">
            <Icon name="content_copy" size={13} />
            Copy
          </span>
        </button>
      )}
    </div>
  )
}
