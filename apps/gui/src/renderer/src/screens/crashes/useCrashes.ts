import type { CrashesList, ErrorJson } from '@ovd/core'
import { useCallback, useEffect, useState } from 'react'
import { syncList } from './crashNew'

export type CrashesState =
  | { status: 'idle' }
  | { status: 'loading'; list?: CrashesList }
  | { status: 'ready'; list: CrashesList }
  | { status: 'error'; error: ErrorJson; list?: CrashesList }

// The target's crash reports, read when the device comes online, when main's watcher says a
// new one appeared, and when the window regains focus. Main polls the vault every 5 s for the
// toast and the badge, so this screen doesn't poll on its own. `device` is null while there is
// nothing to read (no target, or offline).
export function useCrashes(device: string | null): {
  state: CrashesState
  reload: () => Promise<void>
} {
  const [state, setState] = useState<CrashesState>({ status: 'idle' })

  const load = useCallback(
    async (live: () => boolean = () => true): Promise<void> => {
      if (device === null) {
        setState({ status: 'idle' })
        return
      }
      setState((prev) => {
        const list = 'list' in prev && prev.list?.device === device ? prev.list : undefined
        return list ? { status: 'loading', list } : { status: 'loading' }
      })
      const result = await window.ovd.crashes.list(device)
      if (!live()) return
      if (result.ok) syncList(device, result.data.crashes)
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
    [device]
  )

  useEffect(() => {
    let live = true
    void load(() => live)
    const again = (): void => void load(() => live)
    window.addEventListener('focus', again)
    const off = window.ovd.crashes.onNew((event) => {
      if (event.device.id === device) again()
    })
    return () => {
      live = false
      window.removeEventListener('focus', again)
      off()
    }
  }, [load, device])

  return { state, reload: useCallback(() => load(), [load]) }
}
