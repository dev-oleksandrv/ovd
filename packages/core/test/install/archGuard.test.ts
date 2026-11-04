import { describe, expect, test } from 'vitest'
import { compareArch } from '../../src/index.js'

describe('compareArch', () => {
  test.each([
    ['armv7', 'armv7', 'match'],
    ['aarch64', 'aarch64', 'match'],
    ['x86_64', 'x86_64', 'match'],
    ['aarch64', 'armv7', 'mismatch'],
    ['armv7', 'aarch64', 'mismatch'],
    ['x86_64', 'aarch64', 'mismatch'],
    ['any', 'armv7', 'match'],
    ['any', 'x86_64', 'match'],
    ['unknown', 'armv7', 'unknown'],
    ['armv7', 'mips', 'mismatch']
  ] as const)('%s package on a %s target: %s', (pkg, target, verdict) => {
    expect(compareArch(pkg, target)).toBe(verdict)
  })
})
