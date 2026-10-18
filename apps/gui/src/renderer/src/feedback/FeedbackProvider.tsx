import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { FeedbackContext, type Feedback, type ToastInput } from './feedbackContext'
import { addToast, removeToast, TOAST_DURATION_MS, type Toast } from './toastQueue'

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [cli, setCli] = useState<string | null>(null)
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => setToasts((q) => removeToast(q, id)), [])

  const notify = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++
      setToasts((q) => addToast(q, { ...input, id }))
      if (input.cli) setCli(input.cli)
      setTimeout(() => dismiss(id), TOAST_DURATION_MS)
    },
    [dismiss]
  )

  const value = useMemo<Feedback>(
    () => ({ toasts, cli, notify, echo: setCli, dismiss }),
    [toasts, cli, notify, dismiss]
  )

  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>
}
