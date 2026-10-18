import type { ReactNode } from 'react'

interface SidebarProps {
  // Navigation groups; only shipped screens appear (ADR 0018), so this starts empty.
  children?: ReactNode
  footer?: ReactNode
}

export function Sidebar({ children, footer }: SidebarProps) {
  return (
    <nav
      aria-label="Main"
      className="flex w-[204px] flex-none flex-col gap-3.5 overflow-x-hidden overflow-y-auto border-r border-line bg-chrome px-2.5 py-3"
    >
      {children}
      <div className="flex-1" />
      {footer}
    </nav>
  )
}
