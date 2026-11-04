import type { ActivityLog } from '../activity/activityLog.js'
import { createLogged } from '../activity/logged.js'
import { parseInstallApp } from '../adapters/parseInstallApp.js'
import type { PackageArch } from '../adapters/parseVptContents.js'
import type { Devices } from '../devices/devices.js'
import type { Device } from '../devices/types.js'
import { OvdError } from '../errors/ovdError.js'
import type { PackageBuild, PackageInfo, Packages } from '../packages/packages.js'
import { vegaDeviceCmd } from '../sdk/commands.js'
import type { Runner } from '../sdk/runner.js'
import type { SdkLocator } from '../sdk/sdkLocator.js'
import { compareArch, type ArchVerdict } from './archGuard.js'

export interface InstallDeps {
  runner: Runner
  sdk: SdkLocator
  devices: Devices
  packages: Packages
  activity: ActivityLog
}

export interface InstallTarget {
  id: string
  name: string
  // As `vega device info` reports it, normalized (`armv7`, `aarch64`, `x86_64`).
  architecture: string
}

export interface ArchCheck {
  allowed: boolean
  verdict: ArchVerdict
  package: { path: string; architecture: PackageArch }
  target: InstallTarget
  // The newest recent build that matches the target, offered when this package doesn't.
  fix?: PackageBuild
}

export interface InstallResult {
  installed: true
  package: Pick<
    PackageInfo,
    'path' | 'displayPath' | 'file' | 'id' | 'title' | 'version' | 'buildNumber' | 'architecture'
  >
  target: InstallTarget
  // The guard blocked this package and `force` overrode it.
  forced: boolean
}

export interface InstallOptions {
  // An explicit device (`--device`) instead of the target.
  device?: string
  // Install even when the architectures don't match (ADR 0008).
  force?: boolean
}

// Install a .vpkg on the target behind the architecture guard (Stage 2.3, ADR 0008). The SDK
// installs a package built for another architecture without a word
// (fixtures/0.24/vega-device-install-app/installed-wrong-arch.txt), so the guard is the only
// check. Package IDs, project folders and the Apps screen come in 2.4.
export interface Install {
  check(path: string, opts?: { device?: string }): Promise<ArchCheck>
  // Without a path, installs the .vpkg open in no-project mode.
  install(path?: string, opts?: InstallOptions): Promise<InstallResult>
}

// One install took about 1 s on the Virtual Device; a large package over Wi‑Fi takes longer.
const INSTALL_TIMEOUT_MS = 180_000
// Each candidate costs one `vpt show-contents`; the newest few are enough to find a fix.
const MAX_FIX_READS = 5

export function createInstall(deps: InstallDeps): Install {
  const logged = createLogged(deps.activity)

  async function onlineTarget(override?: string): Promise<InstallTarget> {
    const resolved = await deps.devices.currentTarget(override)
    if (!resolved) {
      throw new OvdError(
        'NO_TARGET',
        'No target device',
        'Set one with ovd target set <id>, or pass --device <id>'
      )
    }
    const device = resolved.device
    if (device.status !== 'online') throw offline(device)
    if (!device.info) {
      throw new OvdError(
        'DEVICE_INFO_UNAVAILABLE',
        `Couldn’t read the architecture of ${device.name}`,
        'The device may still be booting. Wait a few seconds and retry'
      )
    }
    return { id: device.id, name: device.name, architecture: device.info.architecture }
  }

  async function findFix(path: string, arch: string): Promise<PackageBuild | undefined> {
    const candidates = (await deps.packages.builds())
      .filter((b) => b.path !== path && (b.folderArch === undefined || b.folderArch === arch))
      .slice(0, MAX_FIX_READS)
    for (const build of candidates) {
      const found = await deps.packages.architecture(build.path).catch(() => 'unknown' as const)
      if (compareArch(found, arch) === 'match') return build
    }
    return undefined
  }

  async function check(path: string, target: InstallTarget, arch: PackageArch): Promise<ArchCheck> {
    const verdict = compareArch(arch, target.architecture)
    const fix = verdict === 'match' ? undefined : await findFix(path, target.architecture)
    return {
      allowed: verdict === 'match',
      verdict,
      package: { path, architecture: arch },
      target,
      ...(fix ? { fix } : {})
    }
  }

  return {
    async check(path, opts = {}) {
      const target = await onlineTarget(opts.device)
      return check(path, target, await deps.packages.architecture(path))
    },

    async install(input, opts = {}) {
      const target = await onlineTarget(opts.device)
      const info = await deps.packages.info(input)
      const force = opts.force ?? false
      const args = { package: info.file, ...(force ? { force: 'true' } : {}) }
      return logged('app.install', target.id, args, async () => {
        const guard = await check(info.path, target, info.architecture)
        if (!guard.allowed && !force) throw blocked(guard, info.file)

        const { vegaPath } = await deps.sdk.get()
        const run = await deps.runner.run(
          vegaDeviceCmd(vegaPath, 'install-app', ['-p', info.path], target.id, {
            timeoutMs: INSTALL_TIMEOUT_MS
          })
        )
        const result = parseInstallApp(run)
        if (!result.installed) {
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
        return {
          installed: true,
          package: {
            path: info.path,
            displayPath: info.displayPath,
            file: info.file,
            id: info.id,
            title: info.title,
            version: info.version,
            buildNumber: info.buildNumber,
            architecture: info.architecture
          },
          target,
          forced: !guard.allowed
        }
      })
    }
  }
}

function offline(device: Device): OvdError {
  return new OvdError(
    'TARGET_OFFLINE',
    `${device.name} is ${device.status === 'stopped' ? 'stopped' : 'offline'}`,
    device.kind === 'vvd'
      ? 'Start it with ovd vvd start'
      : 'Reconnect it, then check with ovd devices'
  )
}

// "Architecture mismatch: package is aarch64, Fire TV Stick 4K Select is armv7" (design copy).
function blocked(guard: ArchCheck, file: string): OvdError {
  const { target, fix } = guard
  const message =
    guard.verdict === 'unknown'
      ? `Architecture unknown: ${file} has native code for several or unrecognized architectures, ${target.name} is ${target.architecture}`
      : `Architecture mismatch: package is ${guard.package.architecture}, ${target.name} is ${target.architecture}`
  const hint = fix
    ? `Install the ${target.architecture} build instead: ovd install ${fix.displayPath}. Or pass --force to install anyway`
    : `Build the app for ${target.architecture} or switch the target. Or pass --force to install anyway`
  return new OvdError('ARCH_MISMATCH', message, hint, {
    package: guard.package.architecture,
    target: target.architecture,
    ...(fix ? { fix: fix.path } : {})
  })
}
