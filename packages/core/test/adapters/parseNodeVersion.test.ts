import { describe, expect, test } from 'vitest'
import { parseNodeVersion } from '../../src/index.js'

describe('parseNodeVersion', () => {
  test('reads the version line', () => {
    expect(parseNodeVersion('v24.21.0\n')).toEqual({ version: '24.21.0' })
  })

  // An interactive login shell can print its own lines (a greeting, a prompt theme) first.
  test('reads the last version line after shell output', () => {
    expect(parseNodeVersion('Welcome back\nv18.0.0 is old\nv22.12.0\n')).toEqual({
      version: '22.12.0'
    })
  })

  test.each(['', 'zsh: command not found: node'])('rejects %j', (out) => {
    expect(() => parseNodeVersion(out)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})
