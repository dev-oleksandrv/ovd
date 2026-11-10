import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ActivityLog } from '../activity/activityLog.js'
import type { Devices } from '../devices/devices.js'
import type { DeviceKind } from '../devices/types.js'
import { offline } from '../devices/onlineTarget.js'
import { OvdError } from '../errors/ovdError.js'
import type { InstallTarget } from '../install/install.js'
import type { PackageBuild, Packages } from '../packages/packages.js'
import { expandHome, tildePath } from '../project/paths.js'
import type { Project } from '../project/project.js'
import { PROJECT_FILES } from '../project/readProject.js'
import { preferredBuildType } from '../run/run.js'
import { watchBuilds, type PrivateBuild } from './buildWatcher.js'
import { privateBuilds } from './privateBuilds.js'

export interface WatchDeps {
  devices: Pick<Devices, 'currentTarget'>
  packages: Pick<Packages, 'builds'>
  project: Pick<Project, 'current'>
  activity: ActivityLog
  homedir: string
  // Relative refs resolve against it (the CLI's working directory).
  cwd: string
  // The packages a build still packs under `build/private/` (default: read from disk).
  privateBuilds?: (folder: string) => Promise<PrivateBuild[]>
}

export interface WatchFolder {
  path: string
  displayPath: string
}

// A settled batch of the watched build folder. `build`: the changed build to redeploy on
// `target` (its architecture, the target's preferred build type first, then the newest), absent
// when none of the changed ones fits it. `error`: the target couldn't be read (NO_TARGET,
// TARGET_OFFLINE…); then there is no `build` either.
export interface BuildChange {
  folder: WatchFolder
  changed: PackageBuild[]
  build?: PackageBuild
  target?: InstallTarget
  error?: OvdError
}

export interface WatchOptions {
  // An explicit device (`--device`) instead of the target.
  device?: string
  signal?: AbortSignal
  pollMs?: number
  // Each batch; the watch waits for it before it polls again, so redeploys never overlap.
  onBuild: (change: BuildChange) => void | Promise<void>
}

// `project-changed`: watching the open project (no ref), and another project was opened (from
// any surface, ADR 0022) or it was closed.
export type WatchEnd = { reason: 'stopped' } | { reason: 'project-changed' }

export interface WatchHandle extends WatchFolder {
  stop(): void
  done: Promise<WatchEnd>
}

// Watch and redeploy (Stage 3.5): watches a project's `build/` folder on the host and hands
// each new build that fits the target to the surface, which redeploys it with `run`. Each batch
// writes one `build.changed` activity entry (ADR 0011), which log sessions show as an OVD line.
export interface Watch {
  // The project folder a watch would watch: `ref` (it must be a Vega project), or the open
  // folder project. NOT_A_PROJECT for anything else (a .vpkg, a package ID, nothing open).
  folder(ref?: string): Promise<WatchFolder>
  // Resolves once the baseline scan is done: builds already there don't count as new.
  start(ref: string | undefined, opts: WatchOptions): Promise<WatchHandle>
}

interface TargetRead {
  // The device the entry names; null without a target.
  id: string | null
  target?: InstallTarget
  kind?: DeviceKind
  error?: OvdError
}

export function createWatch(deps: WatchDeps): Watch {
  const tilde = (path: string) => tildePath(path, deps.homedir)

  const needsFolder = () =>
    new OvdError(
      'NOT_A_PROJECT',
      'ovd run --watch needs a project folder',
      'Pass a project folder or open one with ovd open <folder>'
    )

  async function folder(ref?: string): Promise<WatchFolder> {
    if (ref === undefined) {
      const mode = await deps.project.current()
      if (mode?.kind !== 'folder' || mode.missing) throw needsFolder()
      return { path: mode.path, displayPath: mode.displayPath }
    }
    const path = resolve(deps.cwd, expandHome(ref, deps.homedir))
    const found = await stat(path).catch(() => undefined)
    if (!found?.isDirectory()) throw needsFolder()
    for (const file of PROJECT_FILES) {
      const info = await stat(join(path, file)).catch(() => undefined)
      if (!info?.isFile()) {
        throw new OvdError(
          'NOT_A_PROJECT',
          `Not a Vega project: no ${file} in ${tilde(path)}`,
          'Open the folder that holds manifest.toml and package.json'
        )
      }
    }
    return { path, displayPath: tilde(path) }
  }

  // The target as a run would read it, but offline is passed on, not thrown, with its device:
  // the `build.changed` entry names it, so a live session for it shows the OVD line.
  async function readTarget(device?: string): Promise<TargetRead> {
    let resolved
    try {
      resolved = await deps.devices.currentTarget(device)
    } catch (error) {
      if (error instanceof OvdError) return { id: null, error }
      throw error
    }
    if (!resolved) {
      return {
        id: null,
        error: new OvdError(
          'NO_TARGET',
          'No target device',
          'Set one with ovd target set <id>, or pass --device <id>'
        )
      }
    }
    const { device: found } = resolved
    if (found.status !== 'online') return { id: found.id, error: offline(found) }
    if (!found.info) {
      return {
        id: found.id,
        error: new OvdError(
          'DEVICE_INFO_UNAVAILABLE',
          `Couldn’t read the architecture of ${found.name}`,
          'The device may still be booting. Wait a few seconds and retry'
        )
      }
    }
    return {
      id: found.id,
      kind: found.kind,
      target: { id: found.id, name: found.name, architecture: found.info.architecture }
    }
  }

  return {
    folder,

    async start(ref, opts) {
      const watched = await folder(ref)
      let resolveDone = (_end: WatchEnd): void => undefined
      const done = new Promise<WatchEnd>((r) => (resolveDone = r))
      let ended = false

      const onSettled = async (changed: PackageBuild[]) => {
        if (ended) return
        if (ref === undefined) {
          const mode = await deps.project.current().catch(() => null)
          if (mode?.kind !== 'folder' || mode.path !== watched.path) {
            end({ reason: 'project-changed' })
            return
          }
        }
        const read = await readTarget(opts.device)
        if (ended) return
        const build = read.target && read.kind ? pick(changed, read.target, read.kind) : undefined
        // `changed` is never empty: the watcher only emits a non-empty batch.
        const shown = build ?? changed[0]
        await deps.activity
          .append({
            action: 'build.changed',
            target: read.id,
            args: {
              folder: shown?.folder ?? 'build/',
              file: shown?.file ?? '',
              redeploy: build !== undefined
            },
            ...(read.error
              ? { result: 'error' as const, errorCode: read.error.code }
              : { result: 'ok' as const })
          })
          .catch(() => undefined)
        if (ended) return
        await opts.onBuild({
          folder: watched,
          changed,
          ...(build ? { build } : {}),
          ...(read.target ? { target: read.target } : {}),
          ...(read.error ? { error: read.error } : {})
        })
      }

      const watcher = watchBuilds({
        scan: () => deps.packages.builds(watched.path),
        scanPrivate: () => (deps.privateBuilds ?? privateBuilds)(watched.path),
        ...(opts.pollMs === undefined ? {} : { pollMs: opts.pollMs }),
        onSettled
      })

      const end = (why: WatchEnd) => {
        if (ended) return
        ended = true
        watcher.stop()
        opts.signal?.removeEventListener('abort', onAbort)
        resolveDone(why)
      }
      const onAbort = () => end({ reason: 'stopped' })
      if (opts.signal?.aborted) onAbort()
      else opts.signal?.addEventListener('abort', onAbort, { once: true })

      await watcher.ready
      return { ...watched, stop: () => end({ reason: 'stopped' }), done }
    }
  }
}

// The changed build a run would pick for the target (ADR 0008): its architecture (or one the
// folder doesn't name), the target's preferred build type first, then the newest.
function pick(
  changed: PackageBuild[],
  target: InstallTarget,
  kind: DeviceKind
): PackageBuild | undefined {
  const prefer = preferredBuildType({ kind })
  const matching = changed.filter(
    (b) => b.folderArch === undefined || b.folderArch === target.architecture
  )
  return matching.find((b) => b.folderBuildType === prefer) ?? matching[0]
}
