import type { ErrorCode } from '@ovd/core'
import { expect, test } from 'vitest'
import { exitCodeFor } from '../src/exitCodes.js'

test.each<[ErrorCode, number]>([
  ['SDK_NOT_FOUND', 3],
  ['SDK_MANAGER_MISSING', 3],
  ['VDA_UNAVAILABLE', 3],
  ['DEVICE_NOT_FOUND', 4],
  ['TARGET_OFFLINE', 4],
  ['NO_TARGET', 4],
  ['DEVICE_INFO_UNAVAILABLE', 4],
  ['VVD_NOT_INSTALLED', 4],
  ['NOT_SIGNED_IN', 5],
  ['SESSION_EXPIRED', 5],
  ['NO_VENDORS', 5],
  ['VENDOR_REQUIRED', 5],
  ['CODE_REJECTED', 5],
  ['PAIR_REFUSED', 5],
  ['PAIR_TIMEOUT', 5],
  ['DIFFERENT_NETWORK', 5],
  ['INVALID_ADDRESS', 2],
  ['INVALID_NAME', 2],
  ['INVALID_CODE', 2],
  ['COMMAND_FAILED', 1],
  ['UNEXPECTED_OUTPUT', 1],
  ['VVD_START_FAILED', 1]
])('%s → %i', (code, exit) => {
  expect(exitCodeFor(code)).toBe(exit)
})
