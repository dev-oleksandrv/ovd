import type { ReactNode } from 'react'
import { Icon } from './Icon'

interface BlockedNoticeProps {
  children: ReactNode
  // The one-click way out, shown on the right.
  action?: { label: string; onClick: () => void }
}

// An action OVD refuses to run, with why and the fix (design: the architecture mismatch block).
export function BlockedNotice({ children, action }: BlockedNoticeProps) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2.5 rounded-tile border border-error/35 bg-error/7 px-3 py-2.5"
    >
      <Icon name="block" size={18} className="text-error" />
      <div className="flex-1 text-error-text">{children}</div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="cursor-pointer text-small whitespace-nowrap text-accent hover:underline"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
