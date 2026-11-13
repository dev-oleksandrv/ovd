import type { AppSource } from '../deviceApps/deviceApps.js'
import { isAppId, type AppId } from '../deviceApps/appId.js'
import type { Device } from '../devices/types.js'

export interface InstalledPackage {
  packageId: string
  source: AppSource
}

// The package a report name stands for, or undefined when the report is out of scope.
//
// The name has the package's dots as `_`, which is ambiguous (`com.example.player` and
// `com.example_player` give the same name), so the name is compared with every installed ID
// encoded the same way, never decoded. Reports are in scope only when exactly one installed
// package, of any source, matches and that one is side-loaded (F4): system and store packages
// (`com_amazon_diode`) are never listed, read or pulled, and an ambiguous name is dropped.
export function packageInScope(installed: InstalledPackage[], name: string): AppId | undefined {
  const matches = installed.filter((p) => p.packageId.replaceAll('.', '_') === name)
  const [only] = matches
  if (matches.length !== 1 || only === undefined) return undefined
  if (only.source !== 'sideloaded' || !isAppId(only.packageId)) return undefined
  return only.packageId
}

// A reading of the installed packages is trusted this long, and re-read early (but not more
// often than the minimum) when a report names a package it doesn't list, e.g. an app installed
// since: reading them takes seconds on a stick, so a 5 s poller can't do it every time.
export const SCOPE_TTL_MS = 60_000
export const SCOPE_MIN_REFRESH_MS = 10_000

export interface Scope {
  // The in-scope package of each given name; names out of scope are left out.
  resolve(device: Device, names: ReadonlySet<string>): Promise<Map<string, AppId>>
}

export function createScope(opts: {
  read: (device: Device) => Promise<InstalledPackage[]>
  now?: () => number
}): Scope {
  const now = opts.now ?? Date.now
  const snapshots = new Map<string, { at: number; installed: InstalledPackage[] }>()

  return {
    async resolve(device, names) {
      const found = new Map<string, AppId>()
      if (names.size === 0) return found
      let snapshot = snapshots.get(device.id)
      const age = snapshot === undefined ? Infinity : now() - snapshot.at
      const unknown = (s: { installed: InstalledPackage[] }) =>
        [...names].some((n) => !s.installed.some((p) => p.packageId.replaceAll('.', '_') === n))
      if (
        snapshot === undefined ||
        age >= SCOPE_TTL_MS ||
        (age >= SCOPE_MIN_REFRESH_MS && unknown(snapshot))
      ) {
        snapshot = { at: now(), installed: await opts.read(device) }
        snapshots.set(device.id, snapshot)
      }
      for (const name of names) {
        const id = packageInScope(snapshot.installed, name)
        if (id !== undefined) found.set(name, id)
      }
      return found
    }
  }
}
