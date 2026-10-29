import type { Device, DevicesUpdate } from '@ovd/core'
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
export const sdkMissing: IpcResult<SdkSummary> = {
  ok: false,
  error: { code: 'SDK_NOT_FOUND', message: 'Vega SDK not found', hint: 'Install the Vega SDK' }
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
  platform?: 'darwin' | 'linux'
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
    }
  }
  window.ovd = api
  return { api, push: (update) => listener?.(update) }
}
