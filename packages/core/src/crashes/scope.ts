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
  // `after`: a mark from `mark()`. The snapshot used must have been read after that mark, so it
  // is re-read when it is older, with no rate limit: a report that appeared since the mark may
  // be named like a package installed since the last reading.
  resolve(
    device: Device,
    names: ReadonlySet<string>,
    opts?: { after?: number }
  ): Promise<Map<string, AppId>>
  // A point in time that orders readings: a snapshot read after it has `snapshotMark` above it.
  mark(): number
  // The mark at which the device's current snapshot began being read; undefined when none.
  snapshotMark(deviceId: string): number | undefined
  // Drops the snapshot of a device: the next resolve reads the installed packages.
  invalidate(deviceId: string): void
}

export function createScope(opts: {
  read: (device: Device) => Promise<InstalledPackage[]>
  now?: () => number
}): Scope {
  const now = opts.now ?? Date.now
  // Counts reading starts, so ordering doesn't depend on clock resolution.
  let seq = 0
  const snapshots = new Map<string, { at: number; seq: number; installed: InstalledPackage[] }>()

  return {
    mark: () => seq,
    snapshotMark: (deviceId) => snapshots.get(deviceId)?.seq,

    invalidate(deviceId) {
      snapshots.delete(deviceId)
    },

    async resolve(device, names, resolveOpts = {}) {
      const found = new Map<string, AppId>()
      if (names.size === 0) return found
      let snapshot = snapshots.get(device.id)
      const age = snapshot === undefined ? Infinity : now() - snapshot.at
      const unknown = (s: { installed: InstalledPackage[] }) =>
        [...names].some((n) => !s.installed.some((p) => p.packageId.replaceAll('.', '_') === n))
      const { after } = resolveOpts
      if (
        snapshot === undefined ||
        age >= SCOPE_TTL_MS ||
        (after !== undefined && snapshot.seq <= after) ||
        (age >= SCOPE_MIN_REFRESH_MS && unknown(snapshot))
      ) {
        const started = ++seq
        const installed = await opts.read(device)
        snapshot = { at: now(), seq: started, installed }
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
