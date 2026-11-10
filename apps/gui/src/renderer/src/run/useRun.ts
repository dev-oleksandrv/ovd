import { useCallback, useEffect, useReducer, useRef } from 'react'
import { useFeedback } from '../feedback/feedbackContext'
import { outcomeOf } from '../screens/apps/appsView'
import { outcomeKey, setLaunchOutcome } from '../screens/apps/launchOutcomes'
import type { RunOutcome } from '@ovd/core'
import type { IpcResult } from '../../../preload/api'
import { RUN_NOT_STARTED, runCli, runReducer, runToast, type RunState } from './runView'

export interface RunHook {
  state: RunState
  running: boolean
  start(device: string): Promise<void>
  // A Watch redeploy main runs (Stage 3.5): its steps show as a run's; Watch toasts its outcome.
  redeployStarted(device: string): void
  redeployFinished(result: IpcResult<RunOutcome>, device: string): void
}

// The title bar's Run (Stage 3.4): echoes `ovd run --device <id>` when it starts, shows each
// step as main pushes it, then toasts the outcome. `onDone` runs after a verified launch (the
// Shell opens Logs); a crash's toast offers Logs instead (`onOpenLogs`). A launch that wasn't
// verified also shows on the Apps screen, as an app action's does (`launchOutcomes.ts`).
export function useRun(opts: { onDone: () => void; onOpenLogs: () => void }): RunHook {
  const [state, dispatch] = useReducer(runReducer, { phase: 'idle' })
  const { echo, notify } = useFeedback()
  const running = state.phase === 'running'
  // Read in `start` without making it change on every step.
  const busy = useRef(false)
  const { onDone, onOpenLogs } = opts

  useEffect(
    () => window.ovd.run.onProgress((progress) => dispatch({ kind: 'progress', progress })),
    []
  )

  const start = useCallback(
    async (device: string): Promise<void> => {
      if (busy.current) return
      busy.current = true
      dispatch({ kind: 'start', device })
      echo(runCli(device))
      let result: IpcResult<RunOutcome>
      try {
        result = await window.ovd.run.start(device)
      } catch {
        result = { ok: false, error: RUN_NOT_STARTED }
      } finally {
        busy.current = false
      }
      dispatch({ kind: 'finish', result })
      const toast = runToast(result, device)
      if (!result.ok) {
        notify(toast)
        return
      }
      const { launch } = result.data
      setLaunchOutcome(outcomeKey(device, launch.app.packageId), outcomeOf(launch))
      if (launch.verified) {
        notify(toast)
        onDone()
        return
      }
      notify({ ...toast, action: { label: 'Open Logs', run: onOpenLogs } })
    },
    [echo, notify, onDone, onOpenLogs]
  )

  const redeployStarted = useCallback((device: string) => {
    dispatch({ kind: 'start', device })
  }, [])

  const redeployFinished = useCallback((result: IpcResult<RunOutcome>, device: string) => {
    dispatch({ kind: 'finish', result })
    if (!result.ok) return
    const { launch } = result.data
    setLaunchOutcome(outcomeKey(device, launch.app.packageId), outcomeOf(launch))
  }, [])

  return { state, running, start, redeployStarted, redeployFinished }
}
