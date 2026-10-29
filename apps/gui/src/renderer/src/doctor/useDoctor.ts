import type { DoctorReport, ErrorJson } from '@ovd/core'
import { useCallback, useEffect, useState } from 'react'
import type { IpcResult } from '../../../preload/api'

export type DoctorState =
  | { status: 'loading' }
  | { status: 'ready'; report: DoctorReport }
  | { status: 'error'; error: ErrorJson }

export interface DoctorHook {
  state: DoctorState
  running: boolean
  // Resolves with the result so the caller can toast what changed.
  run(): Promise<IpcResult<DoctorReport>>
}

// One instance for the app: first run decides the start screen from the first report.
export function useDoctor(): DoctorHook {
  const [state, setState] = useState<DoctorState>({ status: 'loading' })
  const [running, setRunning] = useState(true)

  const run = useCallback(async (): Promise<IpcResult<DoctorReport>> => {
    setRunning(true)
    const result = await window.ovd.doctor.run()
    setState(
      result.ok
        ? { status: 'ready', report: result.data }
        : { status: 'error', error: result.error }
    )
    setRunning(false)
    return result
  }, [])

  useEffect(() => {
    void run()
  }, [run])

  return { state, running, run }
}
