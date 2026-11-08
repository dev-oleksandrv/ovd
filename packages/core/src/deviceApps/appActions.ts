import { setTimeout as delay } from 'node:timers/promises'
import { createLogged } from '../activity/logged.js'
import { parseDeviceAppCommand } from '../adapters/parseDeviceAppCommand.js'
import { parseVlcmList } from '../adapters/parseVlcmList.js'
import { parseVlcmTerminate } from '../adapters/parseVlcmTerminate.js'
import { parseVpmComponent, vpmNotFound, type VpmPackage } from '../adapters/parseVpmInfo.js'
import { onlineTarget } from '../devices/onlineTarget.js'
import type { Device } from '../devices/types.js'
import { OvdError } from '../errors/ovdError.js'
import { once, packageOf, type InstallResult, type InstallTarget } from '../install/install.js'
import { vegaDeviceCmd } from '../sdk/commands.js'
import type { RunResult } from '../sdk/runner.js'
import { assertAppId, type AppId } from './appId.js'
import type { AppsDeps, AppsTarget } from './deviceApps.js'
import { notInstalled, sourceOf } from './deviceApps.js'
import {
  createLaunchVerifier,
  LAUNCH_TIMEOUT_MS,
  type LaunchVerification
} from './launchVerification.js'

export interface ActionApp {
  packageId: string
  // From `vpm info <package> --package`.
  title: string
  componentId?: string
}

// What `launch-app` reported, and whether the app runs afterwards: the running component and
// the crash history decide (ADR 0012, `launchVerification.ts`).
export type LaunchResult = {
  target: AppsTarget
  app: ActionApp & { componentId: string }
  launched: true
} & LaunchVerification

export interface TerminateResult {
  target: AppsTarget
  app: ActionApp
  forced: boolean
  // null when forced: `--force` prints the same whether or not the app ran.
  wasRunning: boolean | null
}

export type RestartResult = {
  target: AppsTarget
  app: ActionApp & { componentId: string }
  wasRunning: boolean
  launched: true
} & LaunchVerification

// What a launch or restart does while it verifies.
export interface LaunchOptions {
  device?: string
  // Called once `launch-app` returned, while OVD watches the app.
  onVerifying?: () => void
}

export interface UninstallResult {
  target: AppsTarget
  app: ActionApp
  uninstalled: true
}

export interface ReinstallResult {
  target: InstallTarget
  app: ActionApp
  // false when the app wasn't installed: then it is only installed.
  uninstalled: boolean
  package: InstallResult['package']
  // The guard blocked the package and `force` overrode it.
  forced: boolean
}

// Apps → actions (Stage 2.4). `ref`: a package or component ID, a .vpkg or a project folder;
// without one, the open project's or .vpkg's app. Each action is one activity entry (ADR 0011).
export interface AppActions {
  launch(ref?: string, opts?: LaunchOptions): Promise<LaunchResult>
  terminate(ref?: string, opts?: { device?: string; force?: boolean }): Promise<TerminateResult>
  restart(ref?: string, opts?: LaunchOptions): Promise<RestartResult>
  uninstall(ref?: string, opts?: { device?: string }): Promise<UninstallResult>
  // Uninstall (when installed), then install the package `ovd apps install` would pick.
  reinstall(ref?: string, opts?: { device?: string; force?: boolean }): Promise<ReinstallResult>
}

// What `createApps` shares with the actions.
export interface AppActionsContext {
  deps: AppsDeps
  deviceShell(device: Device, command: string[], timeoutMs?: number): Promise<RunResult>
  shell(device: Device, command: string[], what: string): Promise<RunResult>
  findPackage(device: Device, ref: AppId): Promise<VpmPackage | undefined>
  installedPackage(device: Device, ref: AppId): Promise<VpmPackage>
  packageIdOf(ref: string | undefined): Promise<AppId>
}

const ACTION_TIMEOUT_MS = 60_000

// The error a surface shows for a launch that wasn't verified; `undefined` when it was.
export function launchNotVerified(result: LaunchVerification): OvdError | undefined {
  if (result.verified) return undefined
  return result.reason === 'crashed'
    ? new OvdError(
        'LAUNCH_NOT_VERIFIED',
        'Launch reported success, but the app crashed',
        'See the cause and the logs around the crash, then launch it again'
      )
    : new OvdError(
        'LAUNCH_NOT_VERIFIED',
        'Launch reported success, but the app isn’t running',
        'Check the app with ovd apps info, then launch it again'
      )
}

// An unverified launch is returned with its crash data, and logged as LAUNCH_NOT_VERIFIED.
function notVerifiedOutcome(result: LaunchVerification) {
  if (result.verified) return undefined
  const crash = result.reason === 'crashed' ? result.crash : undefined
  return {
    errorCode: 'LAUNCH_NOT_VERIFIED' as const,
    args: {
      reason: result.reason,
      ...(crash ? { pid: String(crash.pid) } : {}),
      ...(crash?.signal ? { signal: crash.signal } : {})
    }
  }
}

export function createAppActions(ctx: AppActionsContext): AppActions {
  const { deps } = ctx
  const logged = createLogged(deps.activity)
  const verifiedLaunch = createLaunchVerifier(ctx, deps.sleep ?? ((ms) => delay(ms)))

  // Package and component IDs read from the device are checked too before they reach a command.
  const fromDevice = (id: string, device: Device): AppId =>
    assertAppId(id, { from: 'device', device: device.name })

  async function interactiveComponent(device: Device, pkg: VpmPackage): Promise<AppId> {
    const ids = pkg.componentIds.map((id) => fromDevice(id, device))
    const [only] = ids
    if (only !== undefined && ids.length === 1) return only
    for (const id of ids) {
      const run = await ctx.shell(device, ['vpm', 'info', id], 'the app’s components')
      if (vpmNotFound(run.stdout)) continue
      if (parseVpmComponent(run.stdout).type === 'interactive') return id
    }
    throw new OvdError(
      'LAUNCH_FAILED',
      `${pkg.id} has no interactive component`,
      'Only apps with an interactive component can be launched; check them with ovd apps info'
    )
  }

  // `launch-app`, verified. The interactive component comes first: a package without one
  // reads and starts nothing on the device.
  async function launchComponent(
    device: Device,
    pkg: VpmPackage,
    onVerifying: (() => void) | undefined
  ): Promise<{ componentId: AppId; verification: LaunchVerification }> {
    const component = await interactiveComponent(device, pkg)
    const launch = async () => {
      const { vegaPath } = await deps.sdk.get()
      const run = await deps.runner.run(
        vegaDeviceCmd(vegaPath, 'launch-app', ['-a', component], device.id, {
          timeoutMs: LAUNCH_TIMEOUT_MS
        })
      )
      const result = parseDeviceAppCommand(run, 'launch')
      if (!result.ok) {
        if (result.kind === 'not-installed') throw notInstalled(pkg.id, device)
        if (result.kind === 'device-not-found') throw gone(device)
        throw new OvdError(
          'LAUNCH_FAILED',
          `Launch failed: ${result.reason}`,
          'Check the app with ovd apps info, then retry',
          { exitCode: run.exitCode }
        )
      }
    }
    const verification = await verifiedLaunch(device, pkg, component, launch, onVerifying)
    return { componentId: component, verification }
  }

  async function terminatePackage(device: Device, pkg: VpmPackage, force: boolean) {
    const run = await ctx.deviceShell(
      device,
      [
        'vlcm',
        'terminate-app',
        ...(force ? ['--force'] : []),
        '--pkg-id',
        fromDevice(pkg.id, device)
      ],
      ACTION_TIMEOUT_MS
    )
    const result = parseVlcmTerminate(run)
    if (result.outcome === 'failed') {
      throw new OvdError(
        'TERMINATE_FAILED',
        `Stop failed: ${result.reason ?? `exit code ${run.exitCode}`}`,
        'Check the app with ovd apps info, then retry',
        { exitCode: run.exitCode }
      )
    }
    return result.outcome
  }

  async function uninstallPackage(device: Device, pkg: VpmPackage): Promise<void> {
    const source = sourceOf(pkg.installerId)
    if (source !== 'sideloaded') {
      throw new OvdError(
        'NOT_SIDELOADED',
        source === 'store'
          ? `${pkg.title} was installed from the Appstore`
          : `${pkg.title} is a system app`,
        'OVD only uninstalls apps you side-loaded'
      )
    }
    const { vegaPath } = await deps.sdk.get()
    const run = await deps.runner.run(
      vegaDeviceCmd(vegaPath, 'uninstall-app', ['-a', fromDevice(pkg.id, device)], device.id, {
        timeoutMs: ACTION_TIMEOUT_MS
      })
    )
    const result = parseDeviceAppCommand(run, 'uninstall')
    if (!result.ok) {
      if (result.kind === 'not-installed') throw notInstalled(pkg.id, device)
      if (result.kind === 'device-not-found') throw gone(device)
      throw new OvdError(
        'UNINSTALL_FAILED',
        `Uninstall failed: ${result.reason}`,
        'Check the app with ovd apps info, then retry',
        { exitCode: run.exitCode }
      )
    }
  }

  // The app and the target come before `logged`, as for `install`: a failure there (no app,
  // no target, an offline target) writes no activity entry.
  async function prepare(ref: string | undefined, override: string | undefined) {
    const id = await ctx.packageIdOf(ref)
    const device = await onlineTarget(deps.devices, override)
    return { id, device, target: { id: device.id, name: device.name } }
  }

  return {
    async launch(ref, opts = {}) {
      const { id, device, target } = await prepare(ref, opts.device)
      return logged(
        'app.launch',
        device.id,
        { app: id },
        async (): Promise<LaunchResult> => {
          const pkg = await ctx.installedPackage(device, id)
          const { componentId, verification } = await launchComponent(device, pkg, opts.onVerifying)
          return {
            target,
            app: { packageId: pkg.id, title: pkg.title, componentId },
            launched: true as const,
            ...verification
          }
        },
        notVerifiedOutcome
      )
    },

    async terminate(ref, opts = {}) {
      const force = opts.force ?? false
      const { id, device, target } = await prepare(ref, opts.device)
      const args = { app: id, ...(force ? { force: 'true' } : {}) }
      return logged('app.terminate', device.id, args, async () => {
        const pkg = await ctx.installedPackage(device, id)
        const outcome = await terminatePackage(device, pkg, force)
        return {
          target,
          app: { packageId: pkg.id, title: pkg.title },
          forced: force,
          wasRunning: force ? null : outcome === 'stopped'
        }
      })
    },

    async restart(ref, opts = {}) {
      const { id, device, target } = await prepare(ref, opts.device)
      return logged(
        'app.restart',
        device.id,
        { app: id },
        async (): Promise<RestartResult> => {
          const pkg = await ctx.installedPackage(device, id)
          const running = parseVlcmList(
            (await ctx.shell(device, ['vlcm', 'list'], 'the running apps')).stdout
          )
          const wasRunning = running.some((r) => pkg.componentIds.includes(r.application))
          // Graceful stop only when the app runs (`launch-app` itself force-stops it).
          if (wasRunning) await terminatePackage(device, pkg, false)
          const { componentId, verification } = await launchComponent(device, pkg, opts.onVerifying)
          return {
            target,
            app: { packageId: pkg.id, title: pkg.title, componentId },
            wasRunning,
            launched: true as const,
            ...verification
          }
        },
        notVerifiedOutcome
      )
    },

    async uninstall(ref, opts = {}) {
      const { id, device, target } = await prepare(ref, opts.device)
      return logged('app.uninstall', device.id, { app: id }, async () => {
        const pkg = await ctx.installedPackage(device, id)
        await uninstallPackage(device, pkg)
        return { target, app: { packageId: pkg.id, title: pkg.title }, uninstalled: true as const }
      })
    },

    async reinstall(ref, opts = {}) {
      const force = opts.force ?? false
      const steps = deps.install
      const targetOf = once(() => steps.targetDevice(opts.device))
      // As for `install`: the package and the target before `logged`.
      const resolved = await steps.resolve(ref, async () => (await targetOf()).target)
      const { device, target } = await targetOf()
      const info = await deps.packages.info(resolved.path)
      // The ID that reaches the SDK is the package's, whatever the ref was.
      const id = assertAppId(info.id, { from: 'vpkg', file: info.file })
      const args = { app: info.id, package: info.file, ...(force ? { force: 'true' } : {}) }
      return logged('app.reinstall', target.id, args, async () => {
        // The guard first: a blocked package uninstalls nothing.
        const guard = await steps.guard(info, target, {
          force,
          command: 'reinstall',
          ...(resolved.builds ? { builds: resolved.builds } : {})
        })
        const installed = await ctx.findPackage(device, id)
        if (installed) await uninstallPackage(device, installed)
        await steps.run(info, target)
        return {
          target,
          app: { packageId: info.id, title: installed?.title ?? info.title },
          uninstalled: installed !== undefined,
          package: packageOf(info),
          forced: !guard.allowed
        }
      })
    }
  }
}

// `Device not found` from a `vega device` command: the device left after the target check.
function gone(device: Device): OvdError {
  return new OvdError(
    'TARGET_OFFLINE',
    `${device.name} is offline`,
    'Reconnect it, then check with ovd devices'
  )
}
