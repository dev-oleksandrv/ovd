import type { CapturesList, ErrorJson } from '@ovd/core'
import { createContext, useContext } from 'react'
import type { ScreenshotTaken } from '../../../preload/api'

export type CapturesState =
  | { status: 'loading' }
  | { status: 'ready'; list: CapturesList }
  | { status: 'error'; error: ErrorJson }

export interface ScreenshotValue {
  // A take in flight (one at a time).
  busy: boolean
  // Why a take can't start now (no online target, a take running), or null.
  unavailable: string | null
  // Takes one for the target, copies it, toasts and echoes `ovd screenshot --clipboard …`.
  take(): Promise<void>
  // The last take that saved, from this window: a stick's screen view shows it.
  latest: ScreenshotTaken | null
  captures: CapturesState
  // Reads the captures folder again (the Remote screen on mount and focus, Retry).
  refresh(): Promise<void>
  // View-only: no CLI echo.
  reveal(path: string): Promise<void>
  openFolder(): Promise<void>
}

export const ScreenshotContext = createContext<ScreenshotValue | null>(null)

export function useScreenshot(): ScreenshotValue {
  const value = useContext(ScreenshotContext)
  if (!value) throw new Error('useScreenshot must be used inside <ScreenshotProvider>')
  return value
}
