import type { DoctorReport, ErrorJson } from '@ovd/core'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  // A run takes several SDK calls on core's one-at-a-time runner, so a second click joins the
  // run in progress instead of queueing another one behind it (and behind the device polls).
  const inFlight = useRef<Promise<IpcResult<DoctorReport>> | null>(null)

  const run = useCallback((): Promise<IpcResult<DoctorReport>> => {
    if (inFlight.current) return inFlight.current
    setRunning(true)
    const pending = window.ovd.doctor.run().then((result) => {
      setState(
        result.ok
          ? { status: 'ready', report: result.data }
          : { status: 'error', error: result.error }
      )
      setRunning(false)
      inFlight.current = null
      return result
    })
    inFlight.current = pending
    return pending
  }, [])

  useEffect(() => {
    void run()
  }, [run])

  return { state, running, run }
}
