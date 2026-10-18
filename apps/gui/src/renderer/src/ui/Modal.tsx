import { useEffect, type ReactNode } from 'react'
import { IconButton } from './IconButton'

interface ModalProps {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ title, subtitle, onClose, children, footer }: ModalProps) {
  // Esc closes dialogs (keyboard rule in .claude/rules/gui.md).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-100 grid place-items-center bg-backdrop">
      <div
        role="dialog"
        aria-modal
        aria-label={title}
        className="flex w-[540px] max-w-[calc(100vw-32px)] animate-enter flex-col rounded-modal border border-line-strong bg-raised shadow-modal"
      >
        <header className="flex items-center gap-2.5 border-b border-line-menu px-5 pt-4.5 pb-3.5">
          <div className="flex flex-1 flex-col gap-0.5">
            <div className="text-lead font-semibold">{title}</div>
            {subtitle && <div className="text-small text-muted">{subtitle}</div>}
          </div>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </header>
        {children}
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-line-menu px-5 py-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
