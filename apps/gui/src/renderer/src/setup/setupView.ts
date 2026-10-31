import type { Device, ErrorJson } from '@ovd/core'

// Copy and checks of the new-stick wizard, from the design (`setupNext`, `enableCmd`, `ERRS`).
// The design's `ABC-123` code mask is not used: the TV shows 6 characters with no dash
// (fixtures/0.24/README.md).

export const CODE_LENGTH = 6

// What retrying an error does: sign in again, type a new code, or run the step again.
export type SetupRetry = 'login' | 'code' | 'again'

export interface SetupErrorView {
  title: string
  body: string
  cta: string
  retry: SetupRetry
}

// The design's `onSetupCode`: letters and digits only, uppercased, at most 6.
export function cleanCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH)
}

export function enableCommand(code: string, vendor: string): string {
  return `vega devmode enable-device --code ${code || '<code>'}${vendor ? ` --vendor ${vendor}` : ''}`
}

export function setupCli(code = '', vendor = ''): string {
  return `ovd setup-stick${code ? ` --code ${code}` : ''}${vendor ? ` --vendor ${vendor}` : ''}`
}

// The step's primary button: 0 TV, 1 sign-in, 2 code, 3 connect.
export function ctaLabel(
  step: number,
  state: { busy: boolean; signedIn: boolean; enabled: boolean; done: boolean }
): string {
  if (state.busy) return 'Working…'
  if (step === 0) return 'I see the code'
  if (step === 1) return state.signedIn ? 'Continue' : 'Sign in'
  if (step === 2) return state.enabled ? 'Continue' : 'Enable Developer Mode'
  return state.done ? 'Done' : 'Waiting for the stick'
}

export function doneText(device: Device): string {
  const parts = [device.name, device.serial ?? device.id, 'USB', device.info?.architecture]
  return `${parts.filter(Boolean).join(' · ')} — now in Devices`
}

export function errorView(error: ErrorJson): SetupErrorView {
  switch (error.code) {
    case 'NOT_SIGNED_IN':
    case 'SESSION_EXPIRED':
      return {
        title: 'Not signed in',
        body: 'The browser sign-in didn’t finish, so vega devmode login has no session. Sign in again and keep the browser tab open until it says you can return to OVD.',
        cta: 'Sign in again',
        retry: 'login'
      }
    case 'CODE_REJECTED':
      // The design adds "Codes expire after a short time"; how fast is not verified yet.
      return {
        title: 'Code is wrong or expired',
        body: 'vega devmode enable-device rejected the code. On the TV, open Developer Mode again to get a fresh code.',
        cta: 'Enter a new code',
        retry: 'code'
      }
    case 'VENDOR_REQUIRED':
      return {
        title: error.message,
        body: 'Enter the vendor ID from the Amazon Developer Console, then retry.',
        cta: 'Retry',
        retry: 'again'
      }
    default:
      return { title: error.message, body: error.hint, cta: 'Retry', retry: 'again' }
  }
}
