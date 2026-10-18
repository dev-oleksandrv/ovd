import type { ReactNode } from 'react'
import { cx } from './cx'

interface CardProps {
  title: string
  action?: ReactNode
  sunken?: boolean
  children: ReactNode
}

// Bordered section with an uppercase header, e.g. "Running now".
export function Card({ title, action, sunken = false, children }: CardProps) {
  return (
    <section
      className={cx(
        'flex min-w-0 flex-col rounded-card border border-line-soft',
        sunken ? 'bg-sunken' : 'bg-panel'
      )}
    >
      <header className="flex items-center justify-between border-b border-line-soft px-3.5 py-2.5">
        <h3 className="m-0 text-label font-normal tracking-[.06em] text-subtle uppercase">
          {title}
        </h3>
        {action}
      </header>
      {children}
    </section>
  )
}
