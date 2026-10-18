import type { HelloResult } from '@ovd/core'

// The only surface the renderer sees (ADR 0004). Every method maps to one IPC channel in main.
export interface OvdApi {
  hello(): Promise<HelloResult>
}

export const channels = {
  hello: 'ovd:hello'
} as const
