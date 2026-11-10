import type { BuildType } from '../adapters/parseAppConfig.js'
import type { PackageBuild } from '../packages/packages.js'

// A package `react-native build-vega` packs under `build/private/` before it copies it to
// `build/<arch>-<type>/`: `arch` and `buildType` come from its `vega/<arch>/<Debug|Release>/`
// path segments, absent when the path has none.
export interface PrivateBuild {
  path: string
  size: number
  modifiedAt: string
  arch?: 'armv7' | 'aarch64' | 'x86_64'
  buildType?: BuildType
}

export interface BuildWatcherOptions {
  // The folder's builds (`packages.builds(folder)`, which skips `build/private/`).
  scan: () => Promise<PackageBuild[]>
  // The packages under `build/private/`, which tell a build still running (none: another
  // layout, and the build counts as finished once its packages settled).
  scanPrivate?: () => Promise<PrivateBuild[]>
  pollMs?: number
  // How long no package, public or private, may change before a batch goes out.
  quietMs?: number
  // A settled batch: the builds that changed since the last batch, newest first. The next poll
  // waits for it, so batches never overlap; what changes meanwhile comes in the next one.
  onSettled: (builds: PackageBuild[]) => void | Promise<void>
}

export interface BuildWatcher {
  // Resolves once the first scan, the baseline, is done: what is there then never emits.
  ready: Promise<void>
  stop(): void
}

export const BUILD_POLL_MS = 1_000
// Covers the 0.3 s between one architecture's copy and the next one's pack (ARCHITECTURE §8).
export const BUILD_QUIET_MS = 2_000

// Watches a build folder by polling `stat` (ARCHITECTURE §8): `react-native build-vega` packs
// each architecture in turn under `build/private/`, then copies it in place, incrementally, to
// `build/<arch>-<type>/`, and `fs.watch` fires on the partial file while macOS coalesces its
// events. A redeploy while the build still packs makes OVD's `vpt` and the build's clash, and
// both fail, so one batch goes out per finished build, once:
// (a) the changed packages held their size and mtime for a poll,
// (b) no private package is newer than its public copy, or lacks one (the build still packs),
// (c) no package, public or private, changed for `quietMs`.
// A package that is deleted is forgotten, so `build/` removed by a clean and written again is a
// normal scan. A scan that fails is a poll that tells nothing.
export function watchBuilds(opts: BuildWatcherOptions): BuildWatcher {
  const pollMs = opts.pollMs ?? BUILD_POLL_MS
  const quietMs = opts.quietMs ?? BUILD_QUIET_MS
  // The last key (`size:modifiedAt`) seen per path, public and private.
  const known = new Map<string, string>()
  const knownPrivate = new Map<string, string>()
  const pending = new Map<string, PackageBuild>()
  // Time without a change, in polls' worth of ms (fake-timer safe, no wall clock).
  let quietFor = 0
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const keyOf = (build: { size: number; modifiedAt: string }) => `${build.size}:${build.modifiedAt}`

  // Records the scan in `seen` and returns whether a path is new or changed.
  const track = (
    map: Map<string, string>,
    items: { path: string; size: number; modifiedAt: string }[]
  ) => {
    const seen = new Set<string>()
    let changed = false
    for (const item of items) {
      seen.add(item.path)
      const key = keyOf(item)
      if (map.get(item.path) === key) continue
      map.set(item.path, key)
      changed = true
    }
    for (const path of map.keys()) if (!seen.has(path)) map.delete(path)
    return changed
  }

  // undefined when a scan failed.
  const scan = async (): Promise<
    { changed: boolean; builds: PackageBuild[]; privates: PrivateBuild[] } | undefined
  > => {
    let builds: PackageBuild[]
    let privates: PrivateBuild[]
    try {
      builds = await opts.scan()
      privates = opts.scanPrivate ? await opts.scanPrivate() : []
    } catch {
      return undefined
    }
    const before = new Map(known)
    const publicChanged = track(known, builds)
    for (const build of builds) {
      if (before.get(build.path) !== keyOf(build)) pending.set(build.path, build)
    }
    for (const path of pending.keys()) if (!known.has(path)) pending.delete(path)
    const privateChanged = track(knownPrivate, privates)
    return { changed: publicChanged || privateChanged, builds, privates }
  }

  const poll = async () => {
    timer = undefined
    const found = await scan()
    if (stopped) return
    if (found) {
      quietFor = found.changed ? 0 : quietFor + pollMs
      if (
        pending.size > 0 &&
        !found.changed &&
        quietFor >= quietMs &&
        finished(found.builds, found.privates)
      ) {
        const batch = [...pending.values()].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
        pending.clear()
        try {
          await opts.onSettled(batch)
        } catch {
          // The surface reports its own failures; the watch goes on.
        }
      }
    }
    arm()
  }

  const arm = () => {
    if (stopped) return
    timer = setTimeout(() => void poll(), pollMs)
  }

  const ready = (async () => {
    await scan()
    // The baseline: what is there at the start is known, not changed.
    pending.clear()
    arm()
  })()

  return {
    ready,
    stop() {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }
  }
}

// (b): every private package of a known architecture and type has a public copy at least as
// new. Vacuously true without private packages.
function finished(builds: PackageBuild[], privates: PrivateBuild[]): boolean {
  return privates.every((p) => {
    if (p.arch === undefined || p.buildType === undefined) return true
    const copy = builds.find((b) => b.folderArch === p.arch && b.folderBuildType === p.buildType)
    return copy !== undefined && copy.modifiedAt >= p.modifiedAt
  })
}
