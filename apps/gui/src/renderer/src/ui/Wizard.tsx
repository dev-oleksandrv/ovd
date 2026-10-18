import type { ReactNode } from 'react'
import { cx } from './cx'
import { Modal } from './Modal'

interface WizardProps {
  title: string
  subtitle?: string
  step: number
  totalSteps: number
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

// Modal wizard with a progress bar and "Step N of M", as in the setup and pairing flows.
export function Wizard({
  title,
  subtitle,
  step,
  totalSteps,
  onClose,
  children,
  footer
}: WizardProps) {
  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose} footer={footer}>
      <div className="flex gap-1.5 px-5 pt-3.5" aria-hidden>
        {Array.from({ length: totalSteps }, (_, i) => (
          <div
            key={i}
            className={cx('h-[3px] flex-1 rounded-sm', i < step ? 'bg-accent' : 'bg-line-strong')}
          />
        ))}
      </div>
      <div className="flex min-h-[230px] flex-col gap-3 px-5 py-4.5">
        <div className="text-label tracking-[.06em] text-subtle uppercase">
          Step {step} of {totalSteps}
        </div>
        {children}
      </div>
    </Modal>
  )
}
