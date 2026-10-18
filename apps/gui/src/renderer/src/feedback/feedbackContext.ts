import { createContext, useContext } from 'react'
import type { Toast } from './toastQueue'

export type ToastInput = Omit<Toast, 'id'>

export interface Feedback {
  toasts: Toast[]
  cli: string | null
  // Shows a toast; when it carries a CLI equivalent, the status bar echoes it too.
  notify: (toast: ToastInput) => void
  // Echoes a CLI equivalent in the status bar without a toast.
  echo: (cli: string) => void
  dismiss: (id: number) => void
}

export const FeedbackContext = createContext<Feedback | null>(null)

export function useFeedback(): Feedback {
  const value = useContext(FeedbackContext)
  if (!value) throw new Error('useFeedback must be used inside <FeedbackProvider>')
  return value
}
