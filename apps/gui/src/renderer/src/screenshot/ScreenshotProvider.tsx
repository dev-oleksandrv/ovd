import type { ErrorJson } from '@ovd/core'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { targetDevice, useDevicesContext } from '../devices/devicesContext'
import { useFeedback } from '../feedback/feedbackContext'
import type { IpcResult } from '../../../preload/api'
import { ScreenshotContext, type CapturesState, type ScreenshotValue } from './screenshotContext'
import { savedToast, screenshotBlocker, screenshotCli } from './screenshotView'

const TAKE_FAILED: ErrorJson = {
  code: 'SCREENSHOT_FAILED',
  message: 'Couldn’t take the screenshot',
  hint: 'Retry; if it keeps failing, restart OVD'
}
const CAPTURES_UNREADABLE: ErrorJson = {
  code: 'COMMAND_FAILED',
  message: 'Couldn’t read the captures folder',
  hint: 'Retry; if it keeps failing, restart OVD'
}

// The IPC call rejects only on a bug or a torn-down window: that is an error result too, so the
// button never stays busy and the list shows its error with Retry.
async function settled<T>(
  call: () => Promise<IpcResult<T>>,
  error: ErrorJson
): Promise<IpcResult<T>> {
  try {
    return await call()
  } catch {
    return { ok: false, error }
  }
}

// One screenshot state for the window: the Remote screen's button and Captures panel and the
// palette's "Take screenshot" share it, so a take from either shows as busy in both.
export function ScreenshotProvider({ children }: { children: ReactNode }) {
  const { notify } = useFeedback()
  const target = targetDevice(useDevicesContext().state)
  const [busy, setBusy] = useState(false)
  const [latest, setLatest] = useState<ScreenshotValue['latest']>(null)
  const [captures, setCaptures] = useState<CapturesState>({ status: 'loading' })
  // A second click while one runs is ignored, even before `busy` renders.
  const running = useRef(false)

  useEffect(
    () => window.ovd.screenshot.onCaptures((list) => setCaptures({ status: 'ready', list })),
    []
  )

  const refresh = useCallback(async () => {
    const result = await settled(() => window.ovd.screenshot.captures(), CAPTURES_UNREADABLE)
    setCaptures(
      result.ok ? { status: 'ready', list: result.data } : { status: 'error', error: result.error }
    )
  }, [])

  const blocker = screenshotBlocker(target)
  const device = blocker === null ? (target?.id ?? null) : null

  const take = useCallback(async () => {
    if (device === null || running.current) return
    running.current = true
    setBusy(true)
    const cli = screenshotCli(device)
    try {
      const result = await settled(() => window.ovd.screenshot.take(device), TAKE_FAILED)
      if (result.ok) {
        setLatest(result.data)
        notify({ ...savedToast(result.data), cli })
      } else notify({ tone: 'error', text: result.error.message, cli })
    } finally {
      running.current = false
      setBusy(false)
    }
  }, [device, notify])

  const reveal = useCallback(
    async (path: string) => {
      const result = await window.ovd.screenshot.reveal(path)
      if (!result.ok) {
        notify({ tone: 'error', text: result.error.message })
        void refresh()
      }
    },
    [notify, refresh]
  )

  const openFolder = useCallback(async () => {
    const result = await window.ovd.screenshot.openFolder()
    if (!result.ok) notify({ tone: 'error', text: result.error.message })
  }, [notify])

  const value = useMemo<ScreenshotValue>(
    () => ({
      busy,
      unavailable: busy ? 'Taking a screenshot' : blocker,
      take,
      latest,
      captures,
      refresh,
      reveal,
      openFolder
    }),
    [busy, blocker, take, latest, captures, refresh, reveal, openFolder]
  )
  return <ScreenshotContext.Provider value={value}>{children}</ScreenshotContext.Provider>
}
