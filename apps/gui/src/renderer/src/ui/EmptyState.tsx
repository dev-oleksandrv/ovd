import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  body?: string
  // Empty states always offer a way forward (a call to action).
  actions?: ReactNode
}

export function EmptyState({ title, body, actions }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3.5 overflow-auto px-6.5 py-10 text-center">
      <div className="text-title font-semibold">{title}</div>
      {body && <div className="max-w-[420px] leading-normal text-pretty text-muted">{body}</div>}
      {actions && <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  )
}
