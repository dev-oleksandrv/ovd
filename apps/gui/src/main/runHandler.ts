import type { Ovd, RunOutcome } from '@ovd/core'
import type { IpcResult, RunProgress } from '../preload/api'
import { requireText } from './guards'
import { toResult } from './ipcResult'
import type { LogsController } from './logsController'

export interface RunHandlerDeps {
  run: Ovd['run']
  logs: Pick<LogsController, 'armRestart' | 'follow'>
  send: (progress: RunProgress) => void
}

export interface RunHandler {
  // The title bar's Run: refused while a run or a redeploy is in progress.
  run(device: unknown): Promise<IpcResult<RunOutcome>>
  // Watch's redeploy of one build (Stage 3.5): waits for a run in flight instead of refusing.
  redeploy(device: string, path: string): Promise<IpcResult<RunOutcome>>
}

// The title bar's Run (Stage 3.4): core runs what `ovd run --device <id>` runs, with no ref, so
// it installs the open project's build or .vpkg (a dropped file is opened first, ADR 0022). The
// log step goes through main's one log session: a running session for the device is waited on
// until it restarted after the install, one with restart after install off is left alone, and
// without one a session starts. One run at a time, a Watch redeploy included.
export function createRunHandler(deps: RunHandlerDeps): RunHandler {
  // Runs started or waiting; the chain keeps them one at a time.
  let pending = 0
  let tail: Promise<void> = Promise.resolve()

  const exclusive = async <T>(job: () => Promise<T>): Promise<T> => {
    pending++
    const before = tail
    let release = (): void => undefined
    tail = new Promise<void>((resolve) => (release = resolve))
    await before
    try {
      return await job()
    } finally {
      pending--
      release()
    }
  }

  const runOn = async (id: string, ref: string | undefined) => {
    // Armed before the install: the session may restart before the run reaches its log step.
    const arm = deps.logs.armRestart(id)
    try {
      return await toResult(() =>
        deps.run.run(ref, {
          device: id,
          onStep: (step) => deps.send({ kind: 'step', step }),
          followLogs: async (target) => {
            const outcome = await deps.logs.follow(target.id, arm)
            deps.send({ kind: 'logs', outcome })
          }
        })
      )
    } finally {
      arm.cancel()
    }
  }

  return {
    async run(device) {
      const id = requireText(device, 'device')
      if (pending > 0) throw new TypeError('a run is already in progress')
      return exclusive(() => runOn(id, undefined))
    },
    redeploy(device, path) {
      return exclusive(() => runOn(device, path))
    }
  }
}
