import type { ErrorJson } from '@ovd/core'
import { useEffect, useState } from 'react'
import type { CrashDetailResult } from '../../../../preload/api'

export type CrashDetailState =
  | { status: 'loading' }
  | { status: 'ready'; detail: CrashDetailResult }
  | { status: 'error'; error: ErrorJson }

// One report with its stack, read when it is opened (view-only).
export function useCrashDetail(device: string, id: number): CrashDetailState {
  const [state, setState] = useState<CrashDetailState>({ status: 'loading' })

  useEffect(() => {
    let live = true
    setState({ status: 'loading' })
    void window.ovd.crashes.detail({ device, id }).then((result) => {
      if (live) {
        setState(
          result.ok
            ? { status: 'ready', detail: result.data }
            : { status: 'error', error: result.error }
        )
      }
    })
    return () => {
      live = false
    }
  }, [device, id])

  return state
}
