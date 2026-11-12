import type { Device, RemoteKey } from '@ovd/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { InputOutcome, InputState } from '../../../../preload/api'
import { useFeedback } from '../../feedback/feedbackContext'

// How long a pressed key stays lit.
export const FLASH_MS = 150

const IDLE: InputState = { status: 'idle', target: null, backend: null, sent: [] }

export interface InputValue {
  state: InputState
  // The key lit right now, from the pad or the keyboard.
  flash: RemoteKey | null
  press(key: RemoteKey): Promise<void>
  // Resolves true once the device took the text.
  text(text: string): Promise<boolean>
  retry(): void
}

// The Remote screen's session: main keeps one for the target and pushes its state; this hook
// opens it for the online target. Each send echoes its `ovd input …`; only a failure toasts, so a
// run of presses doesn't flood the screen.
export function useInput(target: Device | undefined): InputValue {
  const { echo, notify } = useFeedback()
  const [state, setState] = useState<InputState>(IDLE)
  const [flash, setFlash] = useState<RemoteKey | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const device = target?.status === 'online' ? target.id : null

  useEffect(() => {
    let live = true
    const off = window.ovd.input.onState((s) => setState(s))
    void window.ovd.input.state().then((s) => {
      if (live) setState(s)
    })
    return () => {
      live = false
      off()
    }
  }, [])

  // Main closes the session of an old target itself; a new one opens for the online target, and
  // again when main went idle (the target changed) while the screen is shown.
  const idle = state.status === 'idle'
  const sessionDevice = state.target?.id ?? null
  useEffect(() => {
    if (device !== null && (idle || sessionDevice !== device)) void window.ovd.input.open(device)
  }, [device, idle, sessionDevice])

  useEffect(() => () => clearTimeout(timer.current), [])

  const report = useCallback(
    (outcome: InputOutcome) => {
      if (outcome.ok) echo(outcome.sent.cli)
      else {
        notify({
          tone: 'error',
          text: outcome.sent.error?.message ?? 'Couldn’t send it',
          cli: outcome.sent.cli
        })
      }
    },
    [echo, notify]
  )

  const press = useCallback(
    async (key: RemoteKey) => {
      setFlash(key)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setFlash(null), FLASH_MS)
      report(await window.ovd.input.press(key))
    },
    [report]
  )

  const text = useCallback(
    async (value: string) => {
      const outcome = await window.ovd.input.text(value)
      report(outcome)
      return outcome.ok
    },
    [report]
  )

  const retry = useCallback(() => {
    if (device !== null) void window.ovd.input.open(device)
  }, [device])

  return { state, flash, press, text, retry }
}
