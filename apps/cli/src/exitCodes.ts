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
  NOT_A_VPKG: 2,
  NO_PACKAGE: 2,
  NO_APP: 2,
  INVALID_APP_ID: 2,
  INVALID_LOG_FILTER: 2,
  EXPORT_FILE_EXISTS: 2,
  INVALID_KEY: 2,
  KEY_UNSUPPORTED: 2,
  INVALID_TEXT: 2,
  INVALID_PATH: 2,
  INVALID_TIMEOUT: 2,
  INVALID_CRASH_ID: 2,
  ARCH_MISMATCH: 6,
  LAUNCH_NOT_VERIFIED: 7
}

// A forced stop exits with the shell's code for the signal (128 + its number), documented in
// docs/ARCHITECTURE.md §5: a closed terminal (SIGHUP), Ctrl+C that can't wait for the command,
// and SIGTERM.
export const SIGHUP_EXIT_CODE = 129
export const SIGINT_EXIT_CODE = 130
export const SIGTERM_EXIT_CODE = 143

export function exitCodeFor(code: ErrorCode): number {
  return CODES[code] ?? 1
}
