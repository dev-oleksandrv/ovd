import type { ReactNode } from 'react'
import { Icon } from './Icon'

interface ErrorStateProps {
  title: string
  // One-line fix hint; every error tells the user what to do next.
  hint: string
  command?: string
  actions?: ReactNode
}

export function ErrorState({ title, hint, command, actions }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6.5 py-10 text-center"
    >
      <Icon name="error" size={28} className="text-error" />
      <div className="text-title font-semibold">{title}</div>
      <div className="max-w-[440px] leading-normal text-pretty text-muted">{hint}</div>
      {command && <code className="font-mono text-label text-faint">$ {command}</code>}
      {actions && <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  )
}
