import type { PackageBuild } from '../packages/packages.js'

export interface BuildWatcherOptions {
  // The folder's builds (`packages.builds(folder)`, which skips `build/private/`).
  scan: () => Promise<PackageBuild[]>
  pollMs?: number
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

// Watches a build folder by polling `stat` (ARCHITECTURE §8): `react-native build-vega` writes
// each package in place and incrementally, and `fs.watch` fires on the partial file while macOS
// coalesces its events. A new or changed package counts only once its size and mtime held for
// one full poll; a poll in which none of the pending ones changed again emits them as one
// batch. A package that is deleted is forgotten, so `build/` removed by a clean and written
// again is a normal scan. A scan that fails is a poll with no change.
export function watchBuilds(opts: BuildWatcherOptions): BuildWatcher {
  const pollMs = opts.pollMs ?? BUILD_POLL_MS
  // The last key (`size:modifiedAt`) seen per path.
  const known = new Map<string, string>()
  const pending = new Map<string, PackageBuild>()
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const keyOf = (build: PackageBuild) => `${build.size}:${build.modifiedAt}`

  // Whether anything new or changed came in this scan; undefined when the scan failed.
  const scan = async (): Promise<boolean | undefined> => {
    let builds: PackageBuild[]
    try {
      builds = await opts.scan()
    } catch {
      return undefined
    }
    const seen = new Set<string>()
    let changed = false
    for (const build of builds) {
      seen.add(build.path)
      const key = keyOf(build)
      if (known.get(build.path) === key) continue
      known.set(build.path, key)
      pending.set(build.path, build)
      changed = true
    }
    for (const path of known.keys()) {
      if (seen.has(path)) continue
      known.delete(path)
      pending.delete(path)
    }
    return changed
  }

  const poll = async () => {
    timer = undefined
    const changed = await scan()
    if (stopped) return
    if (changed === false && pending.size > 0) {
      const batch = [...pending.values()].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
      pending.clear()
      try {
        await opts.onSettled(batch)
      } catch {
        // The surface reports its own failures; the watch goes on.
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
