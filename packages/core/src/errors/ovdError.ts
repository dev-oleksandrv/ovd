// Stable error codes: part of the public `--json` contract (ADR 0006), so never rename one.
export const ERROR_CODES = [
  'SDK_NOT_FOUND',
  'SDK_MANAGER_MISSING',
  'VDA_UNAVAILABLE',
  'DEVICE_NOT_FOUND',
  'TARGET_OFFLINE',
  'NO_TARGET',
  'DEVICE_INFO_UNAVAILABLE',
  'VVD_NOT_INSTALLED',
  'VVD_START_FAILED',
  'VVD_STOP_FAILED',
  'VVD_DEVMODE_FAILED',
  'VVD_GRPC_FAILED',
  'NOT_SIGNED_IN',
  'SESSION_EXPIRED',
  'NO_VENDORS',
  'VENDOR_REQUIRED',
  'CODE_REJECTED',
  'INVALID_CODE',
  'PAIR_REFUSED',
  'PAIR_TIMEOUT',
  'DIFFERENT_NETWORK',
  'INVALID_ADDRESS',
  'INVALID_NAME',
  'PATH_NOT_FOUND',
  'NOT_A_PROJECT',
  'NOT_A_VPKG',
  'NO_PACKAGE',
  'ARCH_MISMATCH',
  'INSTALL_FAILED',
  'NO_APP',
  'INVALID_APP_ID',
  'APP_NOT_INSTALLED',
  'NOT_SIDELOADED',
  'LAUNCH_FAILED',
  'LAUNCH_NOT_VERIFIED',
  'TERMINATE_FAILED',
  'UNINSTALL_FAILED',
  'INVALID_LOG_FILTER',
  'LOG_STREAM_ENDED',
  'COMMAND_FAILED',
  'UNEXPECTED_OUTPUT',
  'EXPORT_FILE_EXISTS',
  'EXPORT_FAILED'
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export class OvdError extends Error {
  override readonly name = 'OvdError'

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly hint: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
  }
}

export function isOvdError(value: unknown): value is OvdError {
  return value instanceof OvdError
}

export interface ErrorJson {
  code: ErrorCode
  message: string
  hint: string
}

export function toErrorJson(error: OvdError): ErrorJson {
  return { code: error.code, message: error.message, hint: error.hint }
}
