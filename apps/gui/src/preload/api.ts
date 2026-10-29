import type { Device, DevicesUpdate, ErrorJson, HelloResult } from '@ovd/core'

export interface AppInfo {
  version: string
  platform: 'darwin' | 'linux'
}

// Core errors cross IPC as data: Electron drops custom error fields when a handler throws.
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: ErrorJson }

// The only surface the renderer sees (ADR 0004). Every method maps to one IPC channel in main.
export interface OvdApi {
  appInfo(): Promise<AppInfo>
  hello(): Promise<HelloResult>
  devices: {
    // Polls now and resolves with the result; also what Rescan does.
    list(): Promise<DevicesUpdate>
    rename(id: string, name: string): Promise<IpcResult<Device>>
    setTarget(id: string): Promise<IpcResult<Device>>
    // Main pushes every change while the window is visible; returns an unsubscribe.
    onChange(listener: (update: DevicesUpdate) => void): () => void
  }
}

export const channels = {
  appInfo: 'ovd:app-info',
  hello: 'ovd:hello',
  devicesList: 'ovd:devices:list',
  devicesRename: 'ovd:devices:rename',
  devicesChanged: 'ovd:devices:changed',
  targetSet: 'ovd:target:set'
} as const
