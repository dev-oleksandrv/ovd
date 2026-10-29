import { homedir as osHomedir } from 'node:os'
import { createActivityLog, type Surface } from './activity/activityLog.js'
import { createDevices, type Devices } from './devices/devices.js'
import { defaultDiscoverOptions, discoverSdk, type SdkInfo } from './sdk/discoverSdk.js'
import { createExecaRunner, type Runner } from './sdk/runner.js'
import { createSdkLocator, type SdkLocator } from './sdk/sdkLocator.js'
import { resolveOvdHome } from './state/ovdHome.js'
import { createStateStore } from './state/stateStore.js'

export interface OvdOptions {
  surface: Surface
  env?: Record<string, string | undefined>
  homedir?: string
  runner?: Runner
  discover?: () => Promise<SdkInfo>
  now?: () => Date
}

export interface Ovd {
  sdk: SdkLocator
  devices: Devices
}

// One core per surface process; every surface shares the host state directory (ADR 0022).
export function createOvd(opts: OvdOptions): Ovd {
  const env = opts.env ?? process.env
  const homedir = opts.homedir ?? osHomedir()
  const runner = opts.runner ?? createExecaRunner()
  const home = resolveOvdHome(env, homedir)
  const sdk = createSdkLocator(
    opts.discover ?? (() => discoverSdk({ ...defaultDiscoverOptions(runner), env, homedir }))
  )
  const devices = createDevices({
    runner,
    sdk,
    state: createStateStore(home),
    activity: createActivityLog({
      home,
      surface: opts.surface,
      ...(opts.now ? { now: opts.now } : {})
    }),
    env
  })
  return { sdk, devices }
}
