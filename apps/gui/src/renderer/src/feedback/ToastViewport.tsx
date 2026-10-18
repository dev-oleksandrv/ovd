import { cx } from '../ui/cx'
import { Icon } from '../ui/Icon'
import { toneBorder, toneIcon, toneText } from '../ui/tone'
import { useFeedback } from './feedbackContext'

export function ToastViewport() {
  const { toasts } = useFeedback()
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-10 z-120 flex w-[360px] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={cx(
            'pointer-events-auto flex animate-enter-toast items-start gap-2.5 rounded-tile border border-l-3 border-line-toast bg-selected px-3 py-[11px] shadow-toast',
            toneBorder[toast.tone]
          )}
        >
          <Icon name={toneIcon[toast.tone]} className={toneText[toast.tone]} />
          <div className="flex flex-1 flex-col gap-[3px]">
            <div className="leading-snug font-medium">{toast.text}</div>
            {toast.cli && (
              <div className="font-mono text-label break-all text-muted">$ {toast.cli}</div>
            )}
          </div>
          {toast.action && (
            <button
              type="button"
              onClick={toast.action.run}
              className="cursor-pointer text-small whitespace-nowrap text-accent"
            >
              {toast.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
