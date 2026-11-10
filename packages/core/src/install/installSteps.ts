import { stat } from 'node:fs/promises'
import { basename, resolve as resolvePath } from 'node:path'
import type { BuildType } from '../adapters/parseAppConfig.js'
import { parseInstallApp } from '../adapters/parseInstallApp.js'
import type { PackageArch } from '../adapters/parseVptContents.js'
import { assertAppId } from '../deviceApps/appId.js'
import type { Devices } from '../devices/devices.js'
import { onlineTarget } from '../devices/onlineTarget.js'
import type { Device } from '../devices/types.js'
import { OvdError } from '../errors/ovdError.js'
import type { PackageBuild, PackageInfo, Packages } from '../packages/packages.js'
import { expandHome, tildePath } from '../project/paths.js'
import type { Project } from '../project/project.js'
import { vegaDeviceCmd } from '../sdk/commands.js'
import type { Runner } from '../sdk/runner.js'
import type { SdkLocator } from '../sdk/sdkLocator.js'
import { compareArch } from './archGuard.js'
import type { ArchCheck, InstallTarget } from './install.js'

export interface InstallStepsDeps {
  runner: Runner
  sdk: SdkLocator
  devices: Devices
  packages: Packages
  project: Project
  homedir: string
  // Relative refs resolve against it (the CLI's working directory).
  cwd: string
}

// The .vpkg a ref stands for. `builds`: the folder's builds it was picked from, where the
// guard looks for a fix (a folder outside the open project never offers the project's builds).
export interface ResolvedPackage {
  path: string
  build?: PackageBuild
  builds?: PackageBuild[]
}

export interface GuardOptions {
  force: boolean
  // The command the hint names: `ovd apps install …` or `ovd apps reinstall …`.
  command: 'install' | 'reinstall'
  builds?: PackageBuild[]
}

// The parts of an install that reinstall shares (Stage 2.4): the target, the package a ref
// stands for, the architecture guard (ADR 0008) and the SDK's install. Internal to core.
export interface InstallSteps {
  target(device?: string): Promise<InstallTarget>
  // The same, with the device it names (its VDA serial, for device shell calls).
  targetDevice(device?: string): Promise<{ device: Device; target: InstallTarget }>
  // `ref`: a .vpkg, a project folder or a package ID; without one, the open .vpkg or project.
  // The target is read only when a folder's builds have to be told apart by architecture.
  // `prefer`: among a folder's builds that match the target, the newest of this build type
  // (from the build folder's name) wins; without one of that type, the newest match.
  resolve(
    ref: string | undefined,
    target: () => Promise<InstallTarget>,
    prefer?: BuildType
  ): Promise<ResolvedPackage>
  check(
    path: string,
    target: InstallTarget,
    arch: PackageArch,
    builds?: PackageBuild[]
  ): Promise<ArchCheck>
  // Throws ARCH_MISMATCH when the guard blocks and `force` isn't set.
  guard(info: PackageInfo, target: InstallTarget, opts: GuardOptions): Promise<ArchCheck>
  run(info: PackageInfo, target: InstallTarget): Promise<void>
}

// One install took about 1 s on the Virtual Device; a large package over Wi‑Fi takes longer.
const INSTALL_TIMEOUT_MS = 180_000
// Each candidate costs one `vpt show-contents`; the newest few are enough to find a fix.
const MAX_FIX_READS = 5

export function createInstallSteps(deps: InstallStepsDeps): InstallSteps {
  const tilde = (path: string) => tildePath(path, deps.homedir)

  async function targetDevice(
    override?: string
  ): Promise<{ device: Device; target: InstallTarget }> {
    const device = await onlineTarget(deps.devices, override)
    if (!device.info) {
      throw new OvdError(
        'DEVICE_INFO_UNAVAILABLE',
        `Couldn’t read the architecture of ${device.name}`,
        'The device may still be booting. Wait a few seconds and retry'
      )
    }
    return {
      device,
      target: { id: device.id, name: device.name, architecture: device.info.architecture }
    }
  }

  async function target(override?: string): Promise<InstallTarget> {
    return (await targetDevice(override)).target
  }

  // The newest build that matches the target, else the newest, which the guard then blocks.
  // With `prefer`, the matching builds of that type are tried first, newest first.
  async function pickBuild(
    builds: PackageBuild[],
    folder: string,
    targetOf: () => Promise<InstallTarget>,
    prefer?: BuildType
  ): Promise<ResolvedPackage> {
    const newest = builds[0]
    if (!newest) {
      throw new OvdError(
        'NO_PACKAGE',
        `No build in ${tilde(folder)}/build/`,
        'Build the app, then retry, or pass a .vpkg'
      )
    }
    const { architecture } = await targetOf()
    const matching = builds.filter(
      (b) => b.folderArch === undefined || b.folderArch === architecture
    )
    const ordered =
      prefer === undefined
        ? matching
        : [
            ...matching.filter((b) => b.folderBuildType === prefer),
            ...matching.filter((b) => b.folderBuildType !== prefer)
          ]
    const candidates = ordered.slice(0, MAX_FIX_READS)
    for (const build of candidates) {
      const found = await deps.packages.architecture(build.path).catch(() => 'unknown' as const)
      if (compareArch(found, architecture) === 'match') return { path: build.path, build, builds }
    }
    return { path: newest.path, build: newest, builds }
  }

  async function findFix(
    path: string,
    arch: string,
    builds?: PackageBuild[]
  ): Promise<PackageBuild | undefined> {
    const candidates = (builds ?? (await deps.packages.builds()))
      .filter((b) => b.path !== path && (b.folderArch === undefined || b.folderArch === arch))
      .slice(0, MAX_FIX_READS)
    for (const build of candidates) {
      const found = await deps.packages.architecture(build.path).catch(() => 'unknown' as const)
      if (compareArch(found, arch) === 'match') return build
    }
    return undefined
  }

  async function check(
    path: string,
    target: InstallTarget,
    arch: PackageArch,
    builds?: PackageBuild[]
  ): Promise<ArchCheck> {
    const verdict = compareArch(arch, target.architecture)
    const fix = verdict === 'match' ? undefined : await findFix(path, target.architecture, builds)
    return {
      allowed: verdict === 'match',
      verdict,
      package: { path, architecture: arch },
      target,
      ...(fix ? { fix } : {})
    }
  }

  return {
    target,
    targetDevice,
    check,

    async resolve(ref, targetOf, prefer) {
      const mode = await deps.project.current()
      if (ref === undefined) {
        if (mode?.kind === 'vpkg') return { path: mode.path }
        if (mode?.kind === 'folder' && !mode.missing) {
          return pickBuild(await deps.packages.builds(), mode.path, targetOf, prefer)
        }
        throw new OvdError(
          'NO_PACKAGE',
          'No package given',
          'Pass a .vpkg, a project folder or a package ID, or open one with ovd open'
        )
      }
      const path = resolvePath(deps.cwd, expandHome(ref, deps.homedir))
      const found = await stat(path).catch(() => undefined)
      if (found?.isDirectory()) {
        return pickBuild(await deps.packages.builds(path), path, targetOf, prefer)
      }
      // A path, even a missing one: `packages.info` says what is wrong with it.
      if (found || ref.includes('/') || /\.vpkg$/i.test(ref)) return { path }
      // A package ID: refused here when it isn't one, as every app action does (`appId.ts`).
      assertAppId(ref, { from: 'argument' })
      if (mode?.kind === 'folder' && !mode.missing && mode.packageId === ref) {
        return pickBuild(await deps.packages.builds(), mode.path, targetOf, prefer)
      }
      if (mode?.kind === 'vpkg' && !mode.missing) {
        if ((await deps.packages.info(mode.path)).id === ref) return { path: mode.path }
      }
      throw new OvdError(
        'NO_PACKAGE',
        `No package for ${ref}`,
        'Open its project with ovd open <folder>, or pass a .vpkg'
      )
    },

    async guard(info, target, opts) {
      const result = await check(info.path, target, info.architecture, opts.builds)
      if (!result.allowed && !opts.force) throw blocked(result, info.file, opts.command)
      return result
    },

    async run(info, target) {
      const { vegaPath } = await deps.sdk.get()
      const run = await deps.runner.run(
        vegaDeviceCmd(vegaPath, 'install-app', ['-p', info.path], target.id, {
          timeoutMs: INSTALL_TIMEOUT_MS
        })
      )
      const result = parseInstallApp(run)
      if (result.installed) return
      if (result.kind === 'device-not-found') {
        throw new OvdError(
          'TARGET_OFFLINE',
          `${target.name} is offline`,
          'Reconnect it, then check with ovd devices'
        )
      }
      throw new OvdError(
        'INSTALL_FAILED',
        `Install failed: ${result.reason}`,
        result.kind === 'missing-dependency'
          ? 'The device lacks a module the package needs. The Virtual Device lacks some that sticks have: try a stick'
          : 'Check the package with ovd pkg info, then retry',
        { exitCode: run.exitCode }
      )
    }
  }
}

// What a resolved ref shows as: its build, or the file it names.
export function describeResolved(
  resolved: ResolvedPackage,
  homedir: string
): Pick<PackageBuild, 'path' | 'displayPath' | 'file'> {
  const { path, build } = resolved
  return build
    ? { path: build.path, displayPath: build.displayPath, file: build.file }
    : { path, displayPath: tildePath(path, homedir), file: basename(path) }
}

// "Architecture mismatch: package is aarch64, Fire TV Stick 4K Select is armv7" (design copy).
function blocked(guard: ArchCheck, file: string, command: GuardOptions['command']): OvdError {
  const { target, fix } = guard
  const message =
    guard.verdict === 'unknown'
      ? `Architecture unknown: ${file} has native code for several or unrecognized architectures, ${target.name} is ${target.architecture}`
      : `Architecture mismatch: package is ${guard.package.architecture}, ${target.name} is ${target.architecture}`
  const hint = fix
    ? `Install the ${target.architecture} build instead: ovd apps ${command} ${fix.displayPath}. Or pass --force to ${command} anyway`
    : `Build the app for ${target.architecture} or switch the target. Or pass --force to ${command} anyway`
  return new OvdError('ARCH_MISMATCH', message, hint, {
    package: guard.package.architecture,
    target: target.architecture,
    ...(fix ? { fix: fix.path } : {})
  })
}
