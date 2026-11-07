import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ActivityLog } from '../activity/activityLog.js'
import { parseVlcmList, type VlcmEntry } from '../adapters/parseVlcmList.js'
import { unexpectedOutput } from '../adapters/unexpectedOutput.js'
import {
  parseVpmComponent,
  parseVpmPackages,
  vpmNotFound,
  type VpmPackage
} from '../adapters/parseVpmInfo.js'
import type { Devices } from '../devices/devices.js'
import { onlineTarget } from '../devices/onlineTarget.js'
import type { Device } from '../devices/types.js'
import { OvdError } from '../errors/ovdError.js'
import type { Packages } from '../packages/packages.js'
import type { InstallSteps } from '../install/installSteps.js'
import type { Project } from '../project/project.js'
import { expandHome, tildePath } from '../project/paths.js'
import { readProject } from '../project/readProject.js'
import { vdaCmd } from '../sdk/commands.js'
import type { RunResult, Runner } from '../sdk/runner.js'
import type { SdkLocator } from '../sdk/sdkLocator.js'
import { assertAppId, type AppId } from './appId.js'
import { createAppActions, type AppActions } from './appActions.js'

export interface AppsDeps {
  runner: Runner
  sdk: SdkLocator
  devices: Devices
  project: Project
  packages: Packages
  activity: ActivityLog
  // Reinstall's install half, shared with `ovd apps install`.
  install: InstallSteps
  homedir: string
  cwd: string
}

// A component as `vlcm list` shows it while it runs.
export interface RunningComponent {
  pid: number
  // `VISIBLE`, `READY`…, as the device prints it.
  state: string
  // `PERMANENT`…, as the device prints it (a state, not a duration).
  lifespan: string
  container: string
}

export interface AppComponent {
  id: string
  // From `vpm info <component>`: only `apps.info` reads it.
  type?: string
  launchType?: string
  running?: RunningComponent
}

export type AppStatus = { state: 'running'; pid: number; lifespan: string } | { state: 'stopped' }

export type AppSource = 'sideloaded' | 'store' | 'system'

export interface InstalledApp {
  packageId: string
  title: string
  version: string
  buildNumber: number
  installedAt: string
  updatedAt: string
  // Installed by the developer (`vega device install-app`), from the Appstore, or part of the OS.
  source: AppSource
  components: AppComponent[]
  status: AppStatus
}

export interface AppsTarget {
  id: string
  name: string
}

export interface AppsListOptions {
  device?: string
  // Only apps with a running component.
  running?: boolean
  // System packages too; by default only the side-loaded and store apps.
  all?: boolean
}

export interface AppList {
  target: AppsTarget
  apps: InstalledApp[]
}

export interface AppDetails {
  target: AppsTarget
  app: InstalledApp
}

// Apps (Stage 2.4): what is installed and running on the target, and the actions on it
// (`appActions.ts`). Launch verification against running apps and crash history comes in 2.5.
export interface Apps extends AppActions {
  list(opts?: AppsListOptions): Promise<AppList>
  // `ref`: a package or component ID, a .vpkg or a project folder. Without one, the open
  // project's or .vpkg's app.
  info(ref?: string, opts?: { device?: string }): Promise<AppDetails>
}

// `vpm info` for every package in one device round trip. One call after another takes 31 s for
// the 115 packages of a stick; four at a time take 5 s, but their output interleaves, so each
// goes to its own file in a temp folder, printed in ID order and deleted. `cat`'s exit code
// is kept: an empty folder means the listing failed, not that nothing is installed.
const ALL_PACKAGES_SCRIPT = `d=$(mktemp -d) || exit 1
vpm list packages | tail -n +2 | xargs -P4 -n1 sh -c 'vpm info --package "$1" > "$0/$1"' "$d"
cat "$d"/*
s=$?
rm -rf "$d"
exit $s
`
// `vega exec vda shell` re-wraps its command in a host `sh -c "…"`, which breaks `$` and quotes
// (ARCHITECTURE §8), so the script travels base64-encoded.
const ALL_PACKAGES = `echo ${Buffer.from(ALL_PACKAGES_SCRIPT).toString('base64')} | base64 -d | sh`
const SIDELOADED = 'com.amazon.package-manager.cli'
// `com.amazon.venezia|<content id>`: installed from the Appstore.
const STORE = 'com.amazon.venezia|'
const SOURCE_ORDER: AppSource[] = ['sideloaded', 'store', 'system']
const READ_TIMEOUT_MS = 30_000
// What VDA prints when the device left between the target check and the call.
const GONE = /device '[^']*' not found|device offline|no devices\/emulators found/

export function createApps(deps: AppsDeps): Apps {
  // A device shell call, whatever its exit code. Only a device that left is an error here.
  async function deviceShell(
    device: Device,
    command: string[],
    timeoutMs = READ_TIMEOUT_MS
  ): Promise<RunResult> {
    const { vegaPath } = await deps.sdk.get()
    const run = await deps.runner.run(
      vdaCmd(vegaPath, ['shell', ...command], device.vdaSerial, { timeoutMs })
    )
    if (GONE.test(run.stderr) || GONE.test(run.stdout)) {
      throw new OvdError(
        'TARGET_OFFLINE',
        `${device.name} is offline`,
        device.kind === 'vvd'
          ? 'It may still be booting. Wait a few seconds and retry'
          : 'Reconnect it, then check with ovd devices'
      )
    }
    return run
  }

  // A read: any exit code but `vpm`'s "no info available" is a failure.
  async function shell(device: Device, command: string[], what: string): Promise<RunResult> {
    const run = await deviceShell(device, command)
    if (run.exitCode !== 0 && !vpmNotFound(run.stdout)) {
      throw new OvdError('COMMAND_FAILED', `Couldn’t read ${what} on ${device.name}`, 'Retry', {
        exitCode: run.exitCode,
        stderr: run.stderr.slice(0, 200)
      })
    }
    return run
  }

  // `vpm info <ref> --package`: a component ID prints the package that owns it (ARCHITECTURE §8).
  async function findPackage(device: Device, ref: AppId): Promise<VpmPackage | undefined> {
    const run = await shell(device, ['vpm', 'info', ref, '--package'], 'the app')
    if (vpmNotFound(run.stdout)) return undefined
    const [pkg] = parseVpmPackages(run.stdout)
    if (!pkg) throw unexpectedOutput('vpm info', run.stdout)
    return pkg
  }

  async function installedPackage(device: Device, ref: AppId): Promise<VpmPackage> {
    const pkg = await findPackage(device, ref)
    if (!pkg) throw notInstalled(ref, device)
    return pkg
  }

  async function read(device: Device): Promise<InstalledApp[]> {
    const packages = parseVpmPackages(
      (await shell(device, [ALL_PACKAGES], 'the installed apps')).stdout
    )
    const running = parseVlcmList(
      (await shell(device, ['vlcm', 'list'], 'the running apps')).stdout
    )
    return packages.filter((p) => p.componentIds.length > 0).map((p) => toApp(p, running))
  }

  // The app ID a ref stands for, checked before it reaches any SDK command (`appId.ts`).
  async function packageIdOf(ref: string | undefined): Promise<AppId> {
    if (ref === undefined) {
      const mode = await deps.project.current()
      if (mode?.kind === 'folder' && mode.packageId) {
        return assertAppId(mode.packageId, { from: 'manifest', folder: mode.displayPath })
      }
      if (mode?.kind === 'vpkg') return vpkgId(mode.path)
      throw new OvdError(
        'NO_APP',
        'No app given',
        'Pass a package ID, a .vpkg or a project folder, or list the apps with ovd apps'
      )
    }
    const path = resolve(deps.cwd, expandHome(ref, deps.homedir))
    const found = await stat(path).catch(() => undefined)
    if (found?.isDirectory()) {
      const manifest = await readProject(path)
      if (!manifest.packageId) {
        throw new OvdError(
          'NOT_A_PROJECT',
          `${ref} has no manifest.toml with a package ID`,
          'Pass a Vega project folder, a .vpkg or a package ID'
        )
      }
      return assertAppId(manifest.packageId, {
        from: 'manifest',
        folder: tildePath(path, deps.homedir)
      })
    }
    if (found?.isFile()) return vpkgId(path)
    return assertAppId(ref, { from: 'argument' })
  }

  async function vpkgId(path: string): Promise<AppId> {
    const info = await deps.packages.info(path)
    return assertAppId(info.id, { from: 'vpkg', file: info.file })
  }

  return {
    ...createAppActions({ deps, deviceShell, shell, findPackage, installedPackage, packageIdOf }),

    async list(opts = {}) {
      const device = await onlineTarget(deps.devices, opts.device)
      const apps = (await read(device))
        .filter((a) => opts.all || a.source !== 'system')
        .filter((a) => !opts.running || a.status.state === 'running')
        .sort(bySourceThenTitle)
      return { target: { id: device.id, name: device.name }, apps }
    },

    async info(ref, opts = {}) {
      const id = await packageIdOf(ref)
      const device = await onlineTarget(deps.devices, opts.device)
      const app = (await read(device)).find(
        (a) => a.packageId === id || a.components.some((c) => c.id === id)
      )
      if (!app) throw notInstalled(id, device)
      const components: AppComponent[] = []
      for (const component of app.components) {
        const componentId = assertAppId(component.id, { from: 'device', device: device.name })
        const run = await shell(device, ['vpm', 'info', componentId], 'the app’s components')
        // Uninstalled between the two calls: keep what the list showed.
        if (vpmNotFound(run.stdout)) {
          components.push(component)
          continue
        }
        const { type, launchType } = parseVpmComponent(run.stdout)
        components.push({ ...component, type, ...(launchType ? { launchType } : {}) })
      }
      return { target: { id: device.id, name: device.name }, app: { ...app, components } }
    }
  }
}

function toApp(p: VpmPackage, running: VlcmEntry[]): InstalledApp {
  const components: AppComponent[] = p.componentIds.map((id) => {
    const entry = running.find((r) => r.application === id)
    return entry
      ? {
          id,
          running: {
            pid: entry.pid,
            state: entry.state,
            lifespan: entry.lifespan,
            container: entry.container
          }
        }
      : { id }
  })
  // The app's pid is its interactive component's (`I` in `vlcm list`), else any running one's.
  const main =
    running.find((r) => r.type === 'I' && p.componentIds.includes(r.application)) ??
    running.find((r) => p.componentIds.includes(r.application))
  return {
    packageId: p.id,
    title: p.title,
    version: p.version,
    buildNumber: p.buildNumber,
    installedAt: p.installedAt,
    updatedAt: p.updatedAt,
    source: sourceOf(p.installerId),
    components,
    status: main
      ? { state: 'running', pid: main.pid, lifespan: main.lifespan }
      : { state: 'stopped' }
  }
}

function bySourceThenTitle(a: InstalledApp, b: InstalledApp): number {
  const bySource = SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source)
  return bySource !== 0 ? bySource : a.title.localeCompare(b.title)
}

export function notInstalled(id: string, device: Device): OvdError {
  return new OvdError(
    'APP_NOT_INSTALLED',
    `${id} isn’t installed on ${device.name}`,
    'Install it with ovd apps install, or list what is installed with ovd apps'
  )
}

export function sourceOf(installerId: string): AppSource {
  if (installerId === SIDELOADED) return 'sideloaded'
  return installerId.startsWith(STORE) ? 'store' : 'system'
}
