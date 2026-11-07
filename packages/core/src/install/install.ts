import { stat } from 'node:fs/promises'
import type { ActivityLog } from '../activity/activityLog.js'
import { createLogged } from '../activity/logged.js'
import type { PackageArch } from '../adapters/parseVptContents.js'
import type { PackageBuild, PackageInfo } from '../packages/packages.js'
import type { ArchVerdict } from './archGuard.js'
import {
  createInstallSteps,
  describeResolved,
  type InstallSteps,
  type InstallStepsDeps
} from './installSteps.js'

export interface InstallDeps extends InstallStepsDeps {
  activity: ActivityLog
  // Shared with reinstall (`apps.reinstall`); built from the other deps when not given.
  steps?: InstallSteps
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

// Install a package on the target behind the architecture guard (Stage 2.3, ADR 0008). The SDK
// installs a package built for another architecture without a word
// (fixtures/0.24/vega-device-install-app/installed-wrong-arch.txt), so the guard is the only
// check. A ref is a .vpkg, a project folder (its build that matches the target) or a package ID
// (the open project's or .vpkg's), as for every app action (Stage 2.4).
export interface Install {
  check(path: string, opts?: { device?: string }): Promise<ArchCheck>
  // Without a ref, installs the open .vpkg, or the open project's build.
  install(ref?: string, opts?: InstallOptions): Promise<InstallResult>
  // The .vpkg `install` and `reinstall` would pick for a ref, without installing it.
  resolve(
    ref?: string,
    opts?: { device?: string }
  ): Promise<Pick<PackageBuild, 'path' | 'displayPath' | 'file'>>
}

export function createInstall(deps: InstallDeps): Install {
  const logged = createLogged(deps.activity)
  const steps = deps.steps ?? createInstallSteps(deps)

  return {
    async check(path, opts = {}) {
      const target = await steps.target(opts.device)
      return steps.check(path, target, await deps.packages.architecture(path))
    },

    async install(ref, opts = {}) {
      const targetOf = once(() => steps.target(opts.device))
      const resolved = await steps.resolve(ref, targetOf)
      // The target before the package: no `vpt` read for a target that isn't there.
      const target = await targetOf()
      const info = await deps.packages.info(resolved.path)
      const force = opts.force ?? false
      const args = { package: info.file, ...(force ? { force: 'true' } : {}) }
      return logged('app.install', target.id, args, async () => {
        const guard = await steps.guard(info, target, {
          force,
          command: 'install',
          ...(resolved.builds ? { builds: resolved.builds } : {})
        })
        await steps.run(info, target)
        return {
          installed: true,
          package: packageOf(info),
          target,
          forced: !guard.allowed
        }
      })
    },

    async resolve(ref, opts = {}) {
      const resolved = await steps.resolve(
        ref,
        once(() => steps.target(opts.device))
      )
      if (!resolved.build) {
        const found = await stat(resolved.path).catch(() => undefined)
        // Missing or not a .vpkg: `packages.info` throws the error that says so.
        if (!found?.isFile() || !/\.vpkg$/i.test(resolved.path)) {
          await deps.packages.info(resolved.path)
        }
      }
      return describeResolved(resolved, deps.homedir)
    }
  }
}

export function packageOf(info: PackageInfo): InstallResult['package'] {
  return {
    path: info.path,
    displayPath: info.displayPath,
    file: info.file,
    id: info.id,
    title: info.title,
    version: info.version,
    buildNumber: info.buildNumber,
    architecture: info.architecture
  }
}

// Reads the target at most once, and only when asked.
export function once<T>(read: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | undefined
  return () => (value ??= read())
}
