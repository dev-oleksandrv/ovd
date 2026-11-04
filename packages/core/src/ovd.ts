import { homedir as osHomedir } from 'node:os'
import { createActivityLog, type Surface } from './activity/activityLog.js'
import { createDevices, type Devices } from './devices/devices.js'
import { createDevmode, type Devmode } from './devmode/devmode.js'
import { createDoctor, type Doctor } from './doctor/doctor.js'
import { hostInfo } from './doctor/hostInfo.js'
import { portInUse } from './doctor/portProbe.js'
import { defaultDiscoverOptions, discoverSdk, type SdkInfo } from './sdk/discoverSdk.js'
import { createExecaRunner, type Runner } from './sdk/runner.js'
import { createPackages, type Packages } from './packages/packages.js'
import { createInstall, type Install } from './install/install.js'
import { createPairing, type Pairing } from './pairing/pairing.js'
import { createProject, type Project } from './project/project.js'
import { createSdkLocator, type SdkLocator } from './sdk/sdkLocator.js'
import { createSerialRunner } from './sdk/serialRunner.js'
import { resolveOvdHome } from './state/ovdHome.js'
import { createStateStore } from './state/stateStore.js'
import { createVvd, type Vvd } from './vvd/vvd.js'

export interface OvdOptions {
  surface: Surface
  env?: Record<string, string | undefined>
  homedir?: string
  // Where relative paths given to `project.open` resolve; the process's working directory.
  cwd?: string
  runner?: Runner
  discover?: () => Promise<SdkInfo>
  now?: () => Date
}

export interface Ovd {
  sdk: SdkLocator
  devices: Devices
  doctor: Doctor
  vvd: Vvd
  pairing: Pairing
  devmode: Devmode
  project: Project
  packages: Packages
  install: Install
}

// One core per surface process; every surface shares the host state directory (ADR 0022).
export function createOvd(opts: OvdOptions): Ovd {
  const env = opts.env ?? process.env
  const homedir = opts.homedir ?? osHomedir()
  const runner = createSerialRunner(opts.runner ?? createExecaRunner())
  const home = resolveOvdHome(env, homedir)
  const sdk = createSdkLocator(
    opts.discover ?? (() => discoverSdk({ ...defaultDiscoverOptions(runner), env, homedir }))
  )
  const activity = createActivityLog({
    home,
    surface: opts.surface,
    ...(opts.now ? { now: opts.now } : {})
  })
  const state = createStateStore(home)
  const devices = createDevices({ runner, sdk, state, activity, env })
  const vvd = createVvd({ runner, sdk, devices, activity })
  const project = createProject({ state, homedir, cwd: opts.cwd ?? process.cwd() })
  const doctor = createDoctor({
    runner,
    sdk,
    devices,
    vvd,
    project,
    homedir,
    shell: env.SHELL ?? '/bin/sh',
    host: hostInfo,
    portInUse
  })
  const pairing = createPairing({ runner, sdk, devices, state, activity })
  const devmode = createDevmode({ runner, sdk, devices, activity })
  const packages = createPackages({ runner, sdk, project, homedir, cwd: opts.cwd ?? process.cwd() })
  const install = createInstall({ runner, sdk, devices, packages, activity })
  return { sdk, devices, doctor, vvd, pairing, devmode, project, packages, install }
}
