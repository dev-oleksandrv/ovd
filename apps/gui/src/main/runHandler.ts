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

// The title bar's Run (Stage 3.4): core runs what `ovd run --device <id>` runs, with no ref, so
// it installs the open project's build or .vpkg (a dropped file is opened first, ADR 0022). The
// log step goes through main's one log session: a running session for the device is waited on
// until it restarted after the install, one with restart after install off is left alone, and
// without one a session starts. One run at a time.
export function createRunHandler(
  deps: RunHandlerDeps
): (device: unknown) => Promise<IpcResult<RunOutcome>> {
  let busy = false
  return async (device) => {
    const id = requireText(device, 'device')
    if (busy) throw new TypeError('a run is already in progress')
    busy = true
    // Armed before the install: the session may restart before the run reaches its log step.
    const arm = deps.logs.armRestart(id)
    try {
      return await toResult(() =>
        deps.run.run(undefined, {
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
      busy = false
    }
  }
}
