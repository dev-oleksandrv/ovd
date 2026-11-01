import { describe, expect, test } from 'vitest'
import { parseInstallApp } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

const recorded = (path: string) => fixture(`0.24/vega-device-install-app/${path}`)

describe('parseInstallApp', () => {
  test.each(['installed.txt', 'installed-wrong-arch.txt'])(
    'reads a successful install: %s',
    (file) => {
      expect(parseInstallApp({ stdout: recorded(file), stderr: '', exitCode: 0 })).toEqual({
        installed: true
      })
    }
  )

  test.each([
    [
      'missing-dependency.stderr.txt',
      1,
      'missing-dependency',
      "Unable to install '/tmp/player_aarch64.vpkg' as the required dependencies are not found on the device."
    ],
    [
      'no-such-file.stderr.txt',
      1,
      'failed',
      "vda: error: cannot stat '~/projects/player/nope.vpkg': No such file or directory"
    ],
    [
      'device-not-found.stderr.txt',
      2,
      'device-not-found',
      expect.stringMatching(/^Device not found: Cannot find the device G070000000000001\./)
    ]
  ])('%s', (file, exitCode, kind, reason) => {
    expect(parseInstallApp({ stdout: '', stderr: recorded(file), exitCode })).toEqual({
      installed: false,
      kind,
      reason
    })
  })

  test('falls back to the last stderr line, then the exit code', () => {
    expect(
      parseInstallApp({ stdout: '', stderr: 'boom\nlast words\n', exitCode: 3 })
    ).toMatchObject({ installed: false, reason: 'last words' })
    expect(parseInstallApp({ stdout: '', stderr: '', exitCode: 3 })).toMatchObject({
      installed: false,
      reason: 'exit code 3'
    })
  })

  test('exit 0 without "success" is not an install', () => {
    expect(parseInstallApp({ stdout: '', stderr: '', exitCode: 0 }).installed).toBe(false)
  })
})
