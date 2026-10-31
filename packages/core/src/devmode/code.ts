import { OvdError } from '../errors/ovdError.js'

// The TV shows 6 letters and digits (fixtures/0.24/README.md); dashes, spaces and case are
// forgiven, since the SDK's own help writes codes as `ABC-123`.
export function normalizeCode(input: string): string {
  const code = input.toUpperCase().replace(/[\s-]/g, '')
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    throw new OvdError(
      'INVALID_CODE',
      'The code from the TV has 6 letters and digits',
      'Type the code the TV shows, e.g. ABC123'
    )
  }
  return code
}
