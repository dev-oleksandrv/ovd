import type { ErrorCode } from '@ovd/core'

// Documented in docs/ARCHITECTURE.md §5. Scripts branch on these, so never change one.
const CODES: Partial<Record<ErrorCode, number>> = {
  SDK_NOT_FOUND: 3,
  SDK_MANAGER_MISSING: 3,
  VDA_UNAVAILABLE: 3,
  DEVICE_NOT_FOUND: 4,
  TARGET_OFFLINE: 4,
  NO_TARGET: 4,
  DEVICE_INFO_UNAVAILABLE: 4,
  VVD_NOT_INSTALLED: 4,
  NOT_SIGNED_IN: 5,
  SESSION_EXPIRED: 5,
  NO_VENDORS: 5,
  VENDOR_REQUIRED: 5,
  CODE_REJECTED: 5,
  PAIR_REFUSED: 5,
  PAIR_TIMEOUT: 5,
  DIFFERENT_NETWORK: 5,
  INVALID_ADDRESS: 2,
  INVALID_NAME: 2,
  INVALID_CODE: 2,
  PATH_NOT_FOUND: 2,
  NOT_A_PROJECT: 2,
  NOT_A_VPKG: 2
}

export function exitCodeFor(code: ErrorCode): number {
  return CODES[code] ?? 1
}
