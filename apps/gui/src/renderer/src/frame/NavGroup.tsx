import type { ReactNode } from 'react'

interface NavGroupProps {
  label: string
  children: ReactNode
}

export function NavGroup({ label, children }: NavGroupProps) {
  return (
    <div className="flex flex-col gap-px">
      <div className="px-2.5 pb-1.5 text-micro font-medium tracking-[.08em] text-group uppercase">
        {label}
      </div>
      {children}
    </div>
  )
}
