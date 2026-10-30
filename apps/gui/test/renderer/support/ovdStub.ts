import type { Check, Device, DevicesUpdate, DoctorReport, VvdState } from '@ovd/core'
import { vi } from 'vitest'
import type { IpcResult, OvdApi, SdkSummary } from '../../../src/preload/api'

export interface OvdStub {
  api: OvdApi
  // Pushes an update as main's watcher would.
  push: (update: DevicesUpdate) => void
}

const notFound: IpcResult<Device> = {
  ok: false,
  error: { code: 'DEVICE_NOT_FOUND', message: 'No such device', hint: '' }
}

export const sdkFound: IpcResult<SdkSummary> = { ok: true, data: { sdkVersion: '0.24.12112' } }
const host = { os: 'macOS', osVersion: '26.6', arch: 'arm64', node: '24.2.0' }

// A report shaped like core's: every row ok unless overridden by id.
export function doctorReport(
  overrides: Partial<Record<Check['id'], Partial<Check>>> = {}
): DoctorReport {
  const rows: Check[] = [
    {
      id: 'sdk',
      name: 'Vega SDK',
      status: 'ok',
      detail: '0.24.12112 · Vega CLI 1.4.5 · ~/vega/bin/vega',
      command: 'vega sdk config doctor --json'
    },
    {
      id: 'vda',
      name: 'VDA',
      status: 'ok',
      detail: 'Checked with vega exec vda version',
      command: 'vega exec vda version'
    },
    {
      id: 'devices',
      name: 'Devices',
      status: 'ok',
      detail: '2 online · 0 unavailable',
      command: 'vega exec vda devices -l'
    },
    {
      id: 'devmode',
      name: 'Developer Mode',
      status: 'ok',
      detail:
        'Signed in to Amazon Developer Services · Developer Mode is required for a stick to appear',
      command: 'vega devmode login --json'
    },
    {
      id: 'metro',
      name: 'Metro',
      status: 'info',
      detail: '8081, 8097 free on this computer · no target device',
      command: 'vega device is-port-forwarded'
    },
    { id: 'node', name: 'Node', status: 'ok', detail: 'v24.2.0 (requires ≥ 22)' }
  ]
  return { host, checks: rows.map((row) => ({ ...row, ...overrides[row.id] })) }
}

export const doctorOk: IpcResult<DoctorReport> = { ok: true, data: doctorReport() }

export const sdkMissing: IpcResult<SdkSummary> = {
  ok: false,
  error: { code: 'SDK_NOT_FOUND', message: 'Vega SDK not found', hint: 'Install the Vega SDK' }
}

function unexpected<T>(name: string): IpcResult<T> {
  throw new Error(`unexpected ${name}`)
}

export const ready = (devices: Device[], target: string | null = null): DevicesUpdate => ({
  ok: true,
  devices,
  target
})

// A window.ovd that answers like main: setTarget resolves with the picked device as target.
export function stubOvd(opts: {
  list: () => Promise<DevicesUpdate>
  devices?: Device[]
  sdk?: IpcResult<SdkSummary> | (() => IpcResult<SdkSummary>)
  doctor?: () => IpcResult<DoctorReport>
  platform?: 'darwin' | 'linux'
  vvd?: Partial<OvdApi['vvd']>
  pairing?: Partial<OvdApi['pairing']>
}): OvdStub {
  let listener: ((update: DevicesUpdate) => void) | undefined
  const find = (id: string): Device | undefined => opts.devices?.find((d) => d.id === id)
  const api: OvdApi = {
    appInfo: async () => ({ version: '0.1.0', platform: opts.platform ?? 'darwin' }),
    sdk: {
      info: vi.fn(async () =>
        typeof opts.sdk === 'function' ? opts.sdk() : (opts.sdk ?? sdkFound)
      )
    },
    doctor: {
      run: vi.fn(async () => (opts.doctor ?? (() => doctorOk))())
    },
    devices: {
      list: vi.fn(opts.list),
      rename: vi.fn(async (id: string, name: string): Promise<IpcResult<Device>> => {
        const device = find(id)
        return device ? { ok: true, data: { ...device, name } } : notFound
      }),
      setTarget: vi.fn(async (id: string): Promise<IpcResult<Device>> => {
        const device = find(id)
        return device ? { ok: true, data: { ...device, isTarget: true } } : notFound
      }),
      onChange: (l) => {
        listener = l
        return () => {
          listener = undefined
        }
      }
    },
    vvd: {
      start: vi.fn(opts.vvd?.start ?? (async () => unexpected<VvdState>('vvd.start'))),
      stop: vi.fn(opts.vvd?.stop ?? (async () => unexpected<VvdState>('vvd.stop'))),
      enableDeveloperMode: vi.fn(
        opts.vvd?.enableDeveloperMode ??
          (async () => unexpected<{ developerMode: true }>('vvd.enableDeveloperMode'))
      )
    },
    pairing: {
      pairUsb: vi.fn(opts.pairing?.pairUsb ?? (async () => unexpected<Device>('pairing.pairUsb'))),
      pair: vi.fn(opts.pairing?.pair ?? (async () => unexpected<Device>('pairing.pair'))),
      connect: vi.fn(opts.pairing?.connect ?? (async () => unexpected<Device>('pairing.connect'))),
      forget: vi.fn(
        opts.pairing?.forget ?? (async () => unexpected<{ id: string }>('pairing.forget'))
      )
    }
  }
  window.ovd = api
  return { api, push: (update) => listener?.(update) }
}
