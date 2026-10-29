import { useEffect, useState } from 'react'

export type SdkState =
  { status: 'loading' } | { status: 'found'; version: string } | { status: 'missing' }

// Asks again whenever `recheck` changes: the user may install the SDK while the app is open.
export function useSdk(recheck: unknown): SdkState {
  const [state, setState] = useState<SdkState>({ status: 'loading' })
  useEffect(() => {
    let live = true
    void window.ovd.sdk.info().then((result) => {
      if (!live) return
      setState(
        result.ok ? { status: 'found', version: result.data.sdkVersion } : { status: 'missing' }
      )
    })
    return () => {
      live = false
    }
  }, [recheck])
  return state
}
