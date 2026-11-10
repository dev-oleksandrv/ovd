import {
  toErrorJson,
  type BuildChange,
  type ErrorJson,
  type Ovd,
  type WatchHandle
} from '@ovd/core'
import type { IpcResult, WatchChange, WatchEvent, WatchState } from '../preload/api'
import { requireFlag } from './guards'
import { toResult } from './ipcResult'
import type { LogsController } from './logsController'
import type { RunHandler } from './runHandler'

export interface WatchControllerDeps {
  watch: Pick<Ovd['watch'], 'start'>
  // The run handler's redeploy: it shares the one-run lock with the title bar's Run.
  redeploy: RunHandler['redeploy']
  logs: Pick<LogsController, 'open' | 'running' | 'device'>
  // The target's ID, for the log session Watch makes sure of; null without one.
  target: () => Promise<string | null>
  send: (event: WatchEvent) => void
}

export interface WatchController {
  // `on` comes from the renderer: checked here. Idempotent: on while on returns the state.
  set(on: unknown): Promise<IpcResult<WatchState>>
  state(): WatchState
  // On quit and when the window closes.
  stop(): void
}

// The title bar's Watch (Stage 3.5): main watches the open project (no ref, the remembered
// target, as `ovd run --watch --device <id>` does with that folder and device) and redeploys
// each new build that fits the target through the run handler. Turning it on makes sure a log
// session follows the target, so the `build.changed` OVD line reaches Logs before Logs is
// opened, and each redeploy reuses that session (it restarts after the install, ADR 0014). The
// watch ends by itself when another project is opened (`project-changed`, from any surface).
export function createWatchController(deps: WatchControllerDeps): WatchController {
  let state: WatchState = { watching: false }
  let current: WatchHandle | undefined
  // A start in progress, which a second `set(true)` waits for instead of starting another.
  let starting: Promise<IpcResult<WatchState>> | undefined
  // Bumped by every off: a start that finishes in another generation was turned off meanwhile.
  let generation = 0

  const setState = (next: WatchState) => {
    state = next
    deps.send({ kind: 'state', ...next })
  }

  const followTarget = async () => {
    const id = await deps.target().catch(() => null)
    if (id === null || (deps.logs.running() && deps.logs.device() === id)) return
    await deps.logs.open(id).catch(() => undefined)
  }

  const onBuild = async (change: BuildChange) => {
    deps.send({ kind: 'changed', change: toIpc(change) })
    const { build, target } = change
    if (!build || !target) return
    const outcome = await deps
      .redeploy(target.id, build.path)
      .catch((error: unknown): { ok: false; error: ErrorJson } => ({
        ok: false,
        error: unexpected(error)
      }))
    deps.send({ kind: 'redeployed', device: target.id, result: outcome })
  }

  const start = () =>
    toResult(async (): Promise<WatchState> => {
      const gen = generation
      const handle = await deps.watch.start(undefined, { onBuild })
      // Turned off (or the app quit) while it started: this watch is no longer wanted.
      if (gen !== generation) {
        handle.stop()
        return state
      }
      current = handle
      void handle.done.then((end) => {
        if (current !== handle) return
        current = undefined
        setState({ watching: false })
        if (end.reason === 'project-changed') deps.send({ kind: 'stopped' })
      })
      setState({ watching: true, folder: handle.displayPath })
      await followTarget()
      return state
    })

  const off = () => {
    // A start in flight sees it and stops what it gets; a later `set(true)` starts afresh.
    generation++
    starting = undefined
    const handle = current
    current = undefined
    handle?.stop()
    if (state.watching) setState({ watching: false })
  }

  return {
    async set(value) {
      const on = requireFlag(value, 'on')
      if (!on) {
        off()
        return { ok: true, data: state }
      }
      if (current) return { ok: true, data: state }
      if (!starting) {
        const pending = start().finally(() => {
          if (starting === pending) starting = undefined
        })
        starting = pending
      }
      return starting
    },
    state: () => state,
    stop: off
  }
}

function toIpc(change: BuildChange): WatchChange {
  return {
    folder: change.folder.displayPath,
    changed: change.changed,
    ...(change.build ? { build: change.build } : {}),
    ...(change.target ? { target: change.target } : {}),
    ...(change.error ? { error: toErrorJson(change.error) } : {})
  }
}

// A redeploy that threw something other than a core error (a bug): still a failed redeploy.
function unexpected(error: unknown): ErrorJson {
  return {
    code: 'COMMAND_FAILED',
    message: error instanceof Error ? error.message : String(error),
    hint: 'This is a bug in OVD. Please report it with what you did'
  }
}
