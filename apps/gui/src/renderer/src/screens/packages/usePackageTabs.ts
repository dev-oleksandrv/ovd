import type { PackageFiles, PackageManifestFile, PackageValidation } from '@ovd/core'
import { useCallback, useRef, useState } from 'react'
import type { IpcResult } from '../../../../preload/api'
import type { Load, PackageTab } from './packageTabsView'

export interface PackageTabsData {
  manifest?: Load<PackageManifestFile>
  files?: Load<PackageFiles>
  validation?: Load<PackageValidation>
}

type Part = keyof PackageTabsData

export interface PackageTabs {
  data(path: string): PackageTabsData
  // Reads what a tab shows the first time it opens for a package; Manifest, Files and Validate
  // share one validation, so `vpt validate` runs once per package (discovery D6).
  open(tab: PackageTab, path: string): void
  // A failed read, again.
  retry(part: Part, path: string): void
  // "Validate again".
  revalidate(path: string): Promise<IpcResult<PackageValidation>>
}

// The Stage 5.3 tabs' reads, kept per package path for the session, like Overview's reads.
export function usePackageTabs(): PackageTabs {
  const [all, setAll] = useState<Record<string, PackageTabsData>>({})
  // What was asked for, so a second open while a read is in flight doesn't ask again.
  const requested = useRef(new Set<string>())

  const load = useCallback(
    async <K extends Part>(part: K, path: string): Promise<IpcResult<unknown>> => {
      requested.current.add(`${part}\n${path}`)
      const set = (value: PackageTabsData[K]) =>
        setAll((prev) => ({ ...prev, [path]: { ...prev[path], [part]: value } }))
      set({ status: 'loading' } as PackageTabsData[K])
      const api = window.ovd.packages
      const result: IpcResult<unknown> =
        part === 'manifest'
          ? await api.manifest(path)
          : part === 'files'
            ? await api.files(path)
            : await api.validate(path)
      set(
        (result.ok
          ? { status: 'ready', data: result.data }
          : { status: 'error', error: result.error }) as PackageTabsData[K]
      )
      return result
    },
    []
  )

  const ensure = useCallback(
    (part: Part, path: string) => {
      if (!requested.current.has(`${part}\n${path}`)) void load(part, path)
    },
    [load]
  )

  const open = useCallback(
    (tab: PackageTab, path: string) => {
      if (tab === 'overview') return
      if (tab === 'manifest') ensure('manifest', path)
      if (tab === 'files') ensure('files', path)
      ensure('validation', path)
    },
    [ensure]
  )

  return {
    data: (path) => all[path] ?? {},
    open,
    retry: (part, path) => void load(part, path),
    revalidate: (path) => load('validation', path) as Promise<IpcResult<PackageValidation>>
  }
}
