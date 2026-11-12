import { homedir as osHomedir } from 'node:os'
import { createActivityFeed } from './activity/activityFeed.js'
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
import { createInstallSteps } from './install/installSteps.js'
import { createInput, type Input } from './input/input.js'
import { createScreenshot, type Screenshot } from './screenshot/screenshot.js'
import { createScreen, type Screen } from './screen/screen.js'
import { createApps, type Apps } from './deviceApps/deviceApps.js'
import { createLogs, type Logs } from './logs/logSession.js'
import { createPairing, type Pairing } from './pairing/pairing.js'
import { createRun, type Run } from './run/run.js'
import { createProject, type Project } from './project/project.js'
import { createSdkLocator, type SdkLocator } from './sdk/sdkLocator.js'
import { createSerialRunner } from './sdk/serialRunner.js'
import { resolveOvdHome } from './state/ovdHome.js'
import { createStateStore } from './state/stateStore.js'
import { createEmulator } from './vvd/emulator.js'
import { discoveryDirectories } from './vvd/emulatorDiscovery.js'
import { createVvd, type Vvd } from './vvd/vvd.js'
import { createWatch, type Watch } from './watch/watch.js'

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
  apps: Apps
  logs: Logs
  run: Run
  watch: Watch
  input: Input
  screenshot: Screenshot
  screen: Screen
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
  const emulator = createEmulator({
    homedir,
    env,
    directories: discoveryDirectories({
      homedir,
      env,
      platform: process.platform,
      ...(process.getuid ? { uid: process.getuid() } : {})
    })
  })
  const vvd = createVvd({ runner, sdk, devices, activity, emulator })
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
  const cwd = opts.cwd ?? process.cwd()
  const packages = createPackages({ runner, sdk, project, homedir, cwd })
  // One set of install steps: `install` and `apps.reinstall` resolve and guard alike.
  const steps = createInstallSteps({ runner, sdk, devices, packages, project, homedir, cwd })
  const install = createInstall({
    runner,
    sdk,
    devices,
    packages,
    project,
    activity,
    homedir,
    cwd,
    steps
  })
  const apps = createApps({
    runner,
    sdk,
    devices,
    project,
    packages,
    activity,
    install: steps,
    homedir,
    cwd
  })
  // Tails `activity.jsonl`, so a log session sees the installs of every OVD process.
  const feed = createActivityFeed({ home })
  const logs = createLogs({
    runner,
    sdk,
    devices,
    activity,
    feed,
    now: opts.now ?? (() => new Date())
  })
  const run = createRun({ install, apps, steps, activity })
  const watch = createWatch({ devices, packages, project, activity, homedir, cwd })
  const input = createInput({ runner, sdk, devices, activity, emulator, vvd })
  const screenshot = createScreenshot({
    runner,
    sdk,
    devices,
    activity,
    emulator,
    vvd,
    env,
    homedir,
    cwd,
    platform: process.platform,
    ...(opts.now ? { now: opts.now } : {})
  })
  const screen = createScreen({ devices, activity, emulator, vvd })
  return {
    sdk,
    devices,
    doctor,
    vvd,
    pairing,
    devmode,
    project,
    packages,
    install,
    apps,
    logs,
    run,
    watch,
    input,
    screenshot,
    screen
  }
}
