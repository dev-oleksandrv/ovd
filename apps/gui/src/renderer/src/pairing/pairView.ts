import type { ErrorJson } from '@ovd/core'

// Copy and checks of the pairing wizard, from the design (`pairNext`, `portOk`, `ERRS`).

export type PairRoute = 'usb' | 'tv'

export const DEFAULT_PORT = '5555'

// Same rule as core's `parsePort`, checked as the user types.
export function portOk(port: string): boolean {
  return /^\d+$/.test(port) && Number(port) > 1024 && Number(port) <= 65535
}

export function addressOf(ip: string, port: string): string {
  return `${ip.trim()}:${port}`
}

export function pairCli(route: PairRoute, ip: string, port: string): string {
  return route === 'usb' ? 'ovd pair --usb' : `ovd pair ${addressOf(ip, port)}`
}

// The step's primary button: 0 route, 1 instructions, 2 address, 3 paired.
export function ctaLabel(step: number, route: PairRoute, failed: boolean): string {
  if (failed) return 'Retry'
  if (step === 0) return 'Next'
  if (step === 1) return route === 'usb' ? 'Run & continue' : 'The TV has rebooted'
  if (step === 2) return 'Connect'
  return 'Done'
}

export function errorView(error: ErrorJson, port: string): { title: string; body: string } {
  switch (error.code) {
    case 'DIFFERENT_NETWORK':
      return {
        title: 'Device and computer are on different networks',
        body: `${error.message}. ${error.hint}.`
      }
    case 'PAIR_TIMEOUT':
      return { title: `Port ${port} looks blocked`, body: `vda connect timed out. ${error.hint}.` }
    case 'PAIR_REFUSED':
      return { title: 'Connection refused', body: `${error.message}. ${error.hint}.` }
    default:
      return { title: error.message, body: error.hint }
  }
}
