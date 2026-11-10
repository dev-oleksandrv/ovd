import { createPreflight } from '../activity/logged.js'
import type { ActivityLog } from '../activity/activityLog.js'
import type { BuildType } from '../adapters/parseAppConfig.js'
import type { AppActions, RestartResult } from '../deviceApps/appActions.js'
import type { Device } from '../devices/types.js'
import type { Install, InstallPackage, InstallTarget } from '../install/install.js'
import type { InstallSteps } from '../install/installSteps.js'

export interface RunDeps {
  install: Pick<Install, 'install'>
  apps: Pick<AppActions, 'restart'>
  steps: Pick<InstallSteps, 'targetDevice'>
  activity: ActivityLog
}

export type RunStepName = 'build' | 'install' | 'logs' | 'launch' | 'verify' | 'follow'

// Each step as it starts. `build` is the package the run picked, `install` its install.
export type RunStep =
  | { step: 'build' | 'install'; package: InstallPackage; target: InstallTarget }
  | { step: 'logs' | 'launch' | 'verify' | 'follow' }

export interface RunOptions {
  // An explicit device (`--device`) instead of the target.
  device?: string
  // Install even when the architectures don't match (ADR 0008).
  force?: boolean
  // Checked between steps: an abort stops the run after the step in flight (AbortError).
  signal?: AbortSignal
  onStep?: (step: RunStep) => void
  // Resolves once the surface's log session follows the target, after the install (a session
  // started before it only sees the new app once it restarted, ADR 0014). The session keeps
  // running after the run: the surface owns it and decides what to print and when.
  followLogs: (target: InstallTarget, appId: string) => Promise<void>
}

// Named apart from the runner's `RunResult` (an SDK call's result), which the entry exports too.
export interface RunOutcome {
  target: InstallTarget
  package: InstallPackage
  // The guard blocked the package and `force` overrode it.
  forced: boolean
  // An unverified launch is returned, not thrown: `launchNotVerified` tells the surface.
  launch: RestartResult
}

// Run (Stage 3.4): the one-click deploy. Picks the build that matches the target (ADR 0008:
// release for sticks, debug for the Virtual Device, the architecture from `vega device info`),
// installs it behind the guard, has the surface follow the log, then restarts the app, so every
// run ends with a fresh, verified launch of what it installed (ADR 0012). No activity entry of
// its own: the install, the log session and the launch write theirs (ADR 0011).
export interface Run {
  // `ref`: a .vpkg, a project folder or a package ID; without one, the open .vpkg or project.
  run(ref: string | undefined, opts: RunOptions): Promise<RunOutcome>
}

export function createRun(deps: RunDeps): Run {
  const preflight = createPreflight(deps.activity)

  return {
    async run(ref, opts) {
      const step = (s: RunStep) => opts.onStep?.(s)
      const checkAbort = () => {
        if (opts.signal?.aborted) throw abortError(opts.signal)
      }
      checkAbort()
      // The target first, for the build type. A failure here is the install's (ADR 0011): one
      // `app.install` entry, as `ovd apps install` writes when its target is missing.
      const { device } = await preflight('app.install', async (known) => {
        if (opts.force) known.args.force = 'true'
        return deps.steps.targetDevice(opts.device)
      })
      checkAbort()
      // The package as `onPackage` saw it, with its build folder.
      let picked: InstallPackage | undefined
      const installed = await deps.install.install(ref, {
        device: device.id,
        prefer: preferredBuildType(device),
        ...(opts.force ? { force: true } : {}),
        onPackage: (pkg, target) => {
          picked = pkg
          step({ step: 'build', package: pkg, target })
          step({ step: 'install', package: pkg, target })
        }
      })
      const pkg: InstallPackage = {
        ...installed.package,
        ...(picked?.folder ? { folder: picked.folder } : {})
      }
      checkAbort()
      step({ step: 'logs' })
      await opts.followLogs(installed.target, installed.package.id)
      checkAbort()
      step({ step: 'launch' })
      const launch = await deps.apps.restart(installed.package.id, {
        device: device.id,
        onVerifying: () => step({ step: 'verify' })
      })
      if (launch.verified) step({ step: 'follow' })
      return { target: installed.target, package: pkg, forced: installed.forced, launch }
    }
  }
}

// ADR 0008, last bullet: release builds for sticks, debug builds for the Virtual Device.
export function preferredBuildType(device: Pick<Device, 'kind'>): BuildType {
  return device.kind === 'vvd' ? 'debug' : 'release'
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason
  if (reason instanceof Error && reason.name === 'AbortError') return reason
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}
