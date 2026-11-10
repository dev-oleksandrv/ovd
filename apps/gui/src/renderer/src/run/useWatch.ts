import type { ProjectMode } from '@ovd/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WatchState } from '../../../preload/api'
import { useFeedback } from '../feedback/feedbackContext'
import type { RunHook } from './useRun'
import {
  WATCH_OFF_TOAST,
  WATCH_STOPPED_TOAST,
  changedToast,
  redeployedToast,
  watchOnToast
} from './watchView'

export interface WatchHook {
  watching: boolean
  // Turns Watch on for the target, or off; main says whether it is on.
  toggle(device: string | undefined): Promise<void>
}

// The title bar's Watch (Stage 3.5). Main is the source of truth: the hook reads its state on
// mount (a reload while watching) and follows its pushes. A batch with a build shows as a run's
// steps (`run`), its redeploy as the run's outcome with a toast; one that deploys nothing only
// toasts. Opening another project turns Watch off here; main also ends a watch whose project
// changed elsewhere (`stopped`).
export function useWatch(opts: { mode: ProjectMode | null; run: RunHook }): WatchHook {
  const [state, setState] = useState<WatchState>({ watching: false })
  const { notify } = useFeedback()
  // The device Watch was turned on for: the echo of a batch whose target couldn't be read.
  const device = useRef<string | null>(null)
  const { redeployStarted, redeployFinished } = opts.run
  const watching = state.watching

  useEffect(() => {
    let live = true
    void window.ovd.watch.state().then((s) => {
      if (live) setState(s)
    })
    const unsubscribe = window.ovd.watch.onEvent((event) => {
      switch (event.kind) {
        case 'state':
          setState(event.watching ? { watching: true, folder: event.folder } : { watching: false })
          return
        case 'changed': {
          const { change } = event
          if (change.build && change.target) {
            redeployStarted(change.target.id)
            return
          }
          const toast = changedToast(change, device.current ?? change.target?.id ?? '')
          if (toast) notify(toast)
          return
        }
        case 'redeployed':
          redeployFinished(event.result, event.device)
          notify(redeployedToast(event.result, event.device))
          return
        case 'stopped':
          notify(WATCH_STOPPED_TOAST)
          return
      }
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [notify, redeployStarted, redeployFinished])

  // Another project opened from the desktop: the watch was for the old one.
  const path = opts.mode?.path ?? null
  const watchedPath = useRef(path)
  useEffect(() => {
    if (watchedPath.current === path) return
    const before = watchedPath.current
    watchedPath.current = path
    // From nothing to a project is the project loading (a reload while watching), not a switch:
    // nothing can be watched with nothing open.
    if (!watching || before === null) return
    void window.ovd.watch.set(false).then((result) => {
      if (result.ok) setState(result.data)
    })
    notify(WATCH_OFF_TOAST)
  }, [path, watching, notify])

  const toggle = useCallback(
    async (target: string | undefined): Promise<void> => {
      if (watching) {
        const result = await window.ovd.watch.set(false)
        if (result.ok) setState(result.data)
        notify(WATCH_OFF_TOAST)
        return
      }
      if (target === undefined) return
      device.current = target
      watchedPath.current = path
      const result = await window.ovd.watch.set(true)
      if (!result.ok) {
        notify({ tone: 'error', text: `${result.error.message}. ${result.error.hint}` })
        return
      }
      setState(result.data)
      notify(watchOnToast(target))
    },
    [watching, notify, path]
  )

  return { watching, toggle }
}
