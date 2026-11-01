import type { ErrorJson, ProjectMode } from '@ovd/core'
import { useCallback, useEffect, useState } from 'react'
import type { IpcResult } from '../../../preload/api'
import { useFeedback } from '../feedback/feedbackContext'
import { openedToast } from './projectView'

export type ProjectState =
  | { status: 'loading' }
  | { status: 'ready'; mode: ProjectMode | null }
  | { status: 'error'; error: ErrorJson }

export interface ProjectHook {
  state: ProjectState
  open(path: string): Promise<void>
  pickFolder(): Promise<void>
  pickVpkg(): Promise<void>
}

// The project card's state (Stage 2.1). `onChange` runs after every mode switch, so screens
// that depend on the project (Doctor's Project row) refresh.
export function useProject(onChange: () => void): ProjectHook {
  const [state, setState] = useState<ProjectState>({ status: 'loading' })
  const { notify } = useFeedback()

  useEffect(() => {
    void window.ovd.project.current().then((result) => {
      setState(
        result.ok
          ? { status: 'ready', mode: result.data }
          : { status: 'error', error: result.error }
      )
    })
  }, [])

  const settle = useCallback(
    (result: IpcResult<ProjectMode | null>, cli?: string): void => {
      if (!result.ok) {
        notify({ tone: 'error', text: result.error.message, ...(cli ? { cli } : {}) })
        return
      }
      // The picker was cancelled.
      if (result.data === null) return
      setState({ status: 'ready', mode: result.data })
      notify(openedToast(result.data))
      onChange()
    },
    [notify, onChange]
  )

  return {
    state,
    open: async (path) => settle(await window.ovd.project.open(path), `ovd open ${path}`),
    pickFolder: async () => settle(await window.ovd.project.pickFolder()),
    pickVpkg: async () => settle(await window.ovd.project.pickVpkg())
  }
}
