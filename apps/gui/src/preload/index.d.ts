import type { OvdApi } from './api'

declare global {
  interface Window {
    ovd: OvdApi
  }
}
