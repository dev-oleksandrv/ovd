import type { AppList, ErrorJson } from '@ovd/core'
import { useCallback, useEffect, useState } from 'react'

export type AppsState =
  | { status: 'idle' }
  | { status: 'loading'; list?: AppList }
  | { status: 'ready'; list: AppList }
  | { status: 'error'; error: ErrorJson; list?: AppList }

// The apps on one device, read when the device comes online, when the window regains focus
// and on `reload` (Stage 2.4a: no polling; the design gives Apps no interval). `device` is
// null while there is nothing to read (no target, or offline).
export function useApps(
  device: string | null,
  opts: { running?: boolean } = {}
): { state: AppsState; reload: () => Promise<void> } {
  const [state, setState] = useState<AppsState>({ status: 'idle' })
  const runningOnly = opts.running === true

  const load = useCallback(
    async (live: () => boolean = () => true): Promise<void> => {
      if (device === null) {
        setState({ status: 'idle' })
        return
      }
      // Keep the last list on screen while it is read again, if it is the same device's.
      setState((prev) => {
        const list = 'list' in prev && prev.list?.target.id === device ? prev.list : undefined
        return list ? { status: 'loading', list } : { status: 'loading' }
      })
      const result = await window.ovd.apps.list(device, runningOnly)
      if (!live()) return
      setState((prev) =>
        result.ok
          ? { status: 'ready', list: result.data }
          : {
              status: 'error',
              error: result.error,
              ...('list' in prev && prev.list ? { list: prev.list } : {})
            }
      )
    },
    [device, runningOnly]
  )

  useEffect(() => {
    let live = true
    void load(() => live)
    const onFocus = (): void => void load(() => live)
    window.addEventListener('focus', onFocus)
    return () => {
      live = false
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  return { state, reload: useCallback(() => load(), [load]) }
}
