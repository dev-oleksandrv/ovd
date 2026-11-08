import type { InstalledApp } from '@ovd/core'
import { useCallback, useState } from 'react'
import type { IpcResult } from '../../../../preload/api'
import { useFeedback } from '../../feedback/feedbackContext'
import {
  actionToast,
  appActionCli,
  outcomeOf,
  type AppAction,
  type AppActionResult
} from './appsView'
import { outcomeKey, setLaunchOutcome } from './launchOutcomes'

function call(action: AppAction, id: string, device: string): Promise<IpcResult<AppActionResult>> {
  const apps = window.ovd.apps
  switch (action) {
    case 'launch':
      return apps.launch(id, device)
    case 'terminate':
      return apps.terminate(id, device, false)
    case 'force-stop':
      return apps.terminate(id, device, true)
    case 'restart':
      return apps.restart(id, device)
    case 'uninstall':
      return apps.uninstall(id, device)
    case 'reinstall':
      return apps.reinstall(id, device)
  }
}

// Runs an app action on `device`, echoes its `ovd apps …`, toasts the outcome and reloads the
// list (`onDone`). A launch or restart shows "Verifying…" while it runs and keeps a crash in the
// session store (`launchOutcomes.ts`), which outlives the screen; any other action clears it. Busy state is per app, so actions on two apps don't touch each other's
// buttons; core still runs their SDK calls one at a time.
export function useAppActions(
  device: string | null,
  onDone: () => Promise<void>
): {
  busy: Readonly<Record<string, AppAction>>
  run: (action: AppAction, app: InstalledApp) => Promise<void>
} {
  const { echo, notify } = useFeedback()
  const [busy, setBusy] = useState<Readonly<Record<string, AppAction>>>({})

  const run = useCallback(
    async (action: AppAction, app: InstalledApp): Promise<void> => {
      const id = app.packageId
      if (device === null || busy[id] !== undefined) return
      setBusy((all) => ({ ...all, [id]: action }))
      const key = outcomeKey(device, id)
      const launches = action === 'launch' || action === 'restart'
      setLaunchOutcome(key, launches ? { state: 'verifying' } : undefined)
      const cli = appActionCli(action, id, device)
      echo(cli)
      const result = await call(action, id, device)
      // Written even if the screen unmounted meanwhile: the store outlives it.
      setLaunchOutcome(
        key,
        result.ok && 'verified' in result.data ? outcomeOf(result.data) : undefined
      )
      setBusy((all) => {
        const rest = { ...all }
        delete rest[id]
        return rest
      })
      if (result.ok) {
        notify({ ...actionToast(action, app, result.data), cli })
        await onDone()
        return
      }
      notify({ tone: 'error', text: `${result.error.message}. ${result.error.hint}`, cli })
      // The list said the app was there; it is stale.
      if (result.error.code === 'APP_NOT_INSTALLED') await onDone()
    },
    [device, busy, echo, notify, onDone]
  )

  return { busy, run }
}
