import type { ActivityAction, ActivityLog } from '../activity/activityLog.js'
import { parseDeviceInfo, type DeviceInfo } from '../adapters/parseDeviceInfo.js'
import { parseVdaDevices } from '../adapters/parseVdaDevices.js'
import { parseVvdStatus } from '../adapters/parseVvdStatus.js'
import { OvdError } from '../errors/ovdError.js'
import { vdaCmd, vegaCmd, vegaDeviceCmd } from '../sdk/commands.js'
import type { Runner, RunResult } from '../sdk/runner.js'
import type { SdkLocator } from '../sdk/sdkLocator.js'
import type { HostState, StateStore } from '../state/stateStore.js'
import { canonicalId, classifyVdaEntry, defaultName, VVD_ID } from './deviceModel.js'
import type { Device, DevicesSnapshot, ResolvedTarget, TargetSource } from './types.js'

export interface DevicesDeps {
  runner: Runner
  sdk: SdkLocator
  state: StateStore
  activity: ActivityLog
  env: Record<string, string | undefined>
}

export interface Devices {
  list(): Promise<DevicesSnapshot>
  // `override` is an ID the user passed explicitly (`--device`); it must name a known device.
  currentTarget(override?: string): Promise<ResolvedTarget | null>
  get(id: string): Promise<Device>
  rename(id: string, name: string): Promise<Device>
  setTarget(id: string): Promise<Device>
}

const MAX_NAME = 64

type Unnamed = Omit<Device, 'name' | 'isTarget'>

// The Vega CLI 1.4.5 sometimes fails `vega exec vda …` this way and succeeds on the next run
// (fixtures/0.24/vda-devices/vda-missing-errno.txt).
const VDA_FLAKE = "[Errno 2] No such file or directory: 'vda'"

export function createDevices(deps: DevicesDeps): Devices {
  // Info is read once per device while it stays online (spec D9).
  const infoCache = new Map<string, DeviceInfo>()

  async function vdaDevices(vegaPath: string): Promise<RunResult> {
    const run = () => deps.runner.run(vdaCmd(vegaPath, ['devices', '-l']))
    const first = await run()
    if (first.exitCode !== 0 && first.stdout.trim() === VDA_FLAKE) return run()
    return first
  }

  async function fetchInfo(vegaPath: string, devices: Unnamed[]): Promise<void> {
    const online = new Set(devices.filter((d) => d.status === 'online').map((d) => d.id))
    for (const id of infoCache.keys()) if (!online.has(id)) infoCache.delete(id)
    await Promise.all(
      [...online]
        .filter((id) => !infoCache.has(id))
        .map(async (id) => {
          try {
            const result = await deps.runner.run(vegaDeviceCmd(vegaPath, 'info', [], id))
            if (result.exitCode === 0) infoCache.set(id, parseDeviceInfo(result.stdout))
          } catch (error) {
            // A booting or unreachable device has no info yet; the next list retries it.
            if (!(error instanceof OvdError)) throw error
          }
        })
    )
  }

  async function scan(): Promise<{ found: Unnamed[]; state: HostState }> {
    const { vegaPath } = await deps.sdk.get()
    const [vda, vvd, { state }] = await Promise.all([
      vdaDevices(vegaPath),
      deps.runner.run(vegaCmd(vegaPath, ['virtual-device', 'status'])),
      deps.state.read()
    ])
    if (vda.exitCode !== 0) {
      throw new OvdError(
        'VDA_UNAVAILABLE',
        'VDA is not available',
        'Check the Vega SDK install: vega exec vda version',
        { exitCode: vda.exitCode, stderr: vda.stderr.slice(-500) }
      )
    }

    const found: Unnamed[] = parseVdaDevices(vda.stdout).map((entry) => {
      const { id, kind, connection, ip } = classifyVdaEntry(entry)
      const saved = state.saved.find((s) => s.id === id)
      const serial =
        kind === 'vvd' ? VVD_ID : connection === 'usb' ? entry.vdaSerial : saved?.serial
      return {
        id,
        vdaSerial: entry.vdaSerial,
        ...(serial === undefined ? {} : { serial }),
        kind,
        connection,
        ...(ip === undefined ? {} : { ip }),
        status: entry.state === 'device' ? 'online' : 'offline',
        saved: saved !== undefined
      }
    })

    // A non-zero status means the active SDK has no Virtual Device (spec C3).
    if (vvd.exitCode === 0 && !found.some((d) => d.id === VVD_ID)) {
      const { running } = parseVvdStatus(vvd.stdout)
      found.push({
        id: VVD_ID,
        serial: VVD_ID,
        kind: 'vvd',
        connection: 'local',
        status: running ? 'starting' : 'stopped',
        saved: false
      })
    }

    for (const saved of state.saved) {
      if (found.some((d) => d.id === saved.id)) continue
      found.push({ ...offline(saved.id), serial: saved.serial, saved: true })
    }

    await fetchInfo(vegaPath, found)
    return { found, state }
  }

  function resolve(
    found: Unnamed[],
    state: HostState
  ): { id: string; source: TargetSource } | null {
    const fromEnv = deps.env.VEGA_SERIAL
    if (fromEnv) return { id: canonicalId(fromEnv), source: 'env' }
    if (state.target) return { id: canonicalId(state.target), source: 'remembered' }
    const online = found.filter((d) => d.status === 'online')
    return online.length === 1 && online[0] ? { id: online[0].id, source: 'only-online' } : null
  }

  async function snapshot(): Promise<{ devices: Device[]; target: ResolvedTarget | null }> {
    const { found, state } = await scan()
    const target = resolve(found, state)
    // A remembered target that isn't connected stays the target (spec C4): OVD never switches.
    if (target && !found.some((d) => d.id === target.id)) found.push(offline(target.id))

    const stickSerials = found.filter((d) => d.kind === 'stick').map((d) => d.serial ?? d.id)
    const devices = found.map((d): Device => {
      const key = d.serial ?? d.id
      const info = infoCache.get(d.id)
      return {
        ...d,
        name: state.names[key] ?? defaultName(d.kind, key, stickSerials),
        isTarget: d.id === target?.id,
        ...(info && d.status === 'online' ? { info } : {})
      }
    })
    const device = target && devices.find((d) => d.id === target.id)
    return { devices, target: device ? { device, source: target.source } : null }
  }

  async function find(id: string): Promise<Device> {
    const { devices } = await snapshot()
    const device = devices.find((d) => d.id === canonicalId(id))
    if (!device) {
      throw new OvdError(
        'DEVICE_NOT_FOUND',
        `No device ${id}`,
        'See connected devices: ovd devices'
      )
    }
    return device
  }

  // Device actions are logged whether they succeed or fail (ADR 0011).
  async function logged<T>(
    action: ActivityAction,
    id: string,
    args: Record<string, string>,
    run: () => Promise<T>
  ): Promise<T> {
    const target = canonicalId(id)
    try {
      const value = await run()
      await deps.activity.append({ action, target, args, result: 'ok' })
      return value
    } catch (error) {
      if (error instanceof OvdError) {
        await deps.activity.append({ action, target, args, result: 'error', errorCode: error.code })
      }
      throw error
    }
  }

  return {
    get: find,

    rename(id, name) {
      const trimmed = name.trim()
      return logged('device.rename', id, { name: trimmed }, async () => {
        if (trimmed === '' || trimmed.length > MAX_NAME) {
          throw new OvdError(
            'INVALID_NAME',
            `A device name needs 1–${MAX_NAME} characters`,
            `Use 1–${MAX_NAME} characters`
          )
        }
        const device = await find(id)
        const key = device.serial ?? device.id
        await deps.state.update((s) => ({ ...s, names: { ...s.names, [key]: trimmed } }))
        return { ...device, name: trimmed }
      })
    },

    setTarget(id) {
      return logged('target.set', id, {}, async () => {
        const device = await find(id)
        await deps.state.update((s) => ({ ...s, target: device.id }))
        return { ...device, isTarget: true }
      })
    },

    async list() {
      const { devices, target } = await snapshot()
      return { devices, target: target?.device.id ?? null }
    },

    async currentTarget(override) {
      const { devices, target } = await snapshot()
      if (override === undefined) return target
      const id = canonicalId(override)
      const device = devices.find((d) => d.id === id)
      if (!device) {
        throw new OvdError(
          'DEVICE_NOT_FOUND',
          `No device ${override}`,
          'See connected devices: ovd devices'
        )
      }
      return { device: { ...device, isTarget: true }, source: 'flag' }
    }
  }
}

function offline(id: string): Unnamed {
  const { kind, connection, ip } = classifyVdaEntry({ vdaSerial: id, state: 'offline', props: {} })
  return {
    id,
    kind,
    connection,
    ...(ip === undefined ? {} : { ip }),
    status: kind === 'vvd' ? 'stopped' : 'offline',
    saved: false
  }
}
