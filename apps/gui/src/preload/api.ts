import type { HelloResult } from '@ovd/core'

export interface AppInfo {
  version: string
  platform: 'darwin' | 'linux'
}

// The only surface the renderer sees (ADR 0004). Every method maps to one IPC channel in main.
export interface OvdApi {
  appInfo(): Promise<AppInfo>
  hello(): Promise<HelloResult>
}

export const channels = {
  appInfo: 'ovd:app-info',
  hello: 'ovd:hello'
} as const
