import { describe, expect, test } from 'vitest'
import { parseDeviceAppCommand } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

const recorded = (path: string) => fixture(`0.24/${path}`)

describe('parseDeviceAppCommand', () => {
  test.each([
    ['launch', 'vega-device-launch-app/launched.txt'],
    ['uninstall', 'vega-device-uninstall-app/uninstalled.txt']
  ] as const)('%s: %s is a success', (verb, file) => {
    expect(
      parseDeviceAppCommand({ stdout: recorded(file), stderr: '', exitCode: 0 }, verb)
    ).toEqual({ ok: true })
  })

  test.each([
    ['launch', 'vega-device-launch-app/not-installed.stderr.txt', 3, 'not-installed'],
    ['launch', 'vega-device-launch-app/device-not-found.stderr.txt', 2, 'device-not-found'],
    ['uninstall', 'vega-device-uninstall-app/not-installed.stderr.txt', 3, 'not-installed'],
    ['uninstall', 'vega-device-uninstall-app/device-not-found.stderr.txt', 2, 'device-not-found']
  ] as const)('%s: %s (exit %i) is %s', (verb, file, exitCode, kind) => {
    const result = parseDeviceAppCommand({ stdout: '', stderr: recorded(file), exitCode }, verb)
    expect(result).toEqual({
      ok: false,
      kind,
      reason:
        kind === 'not-installed'
          ? 'Failed: App could not be determined'
          : expect.stringMatching(/^Device not found: Cannot find the device G070000000000001\./)
    })
  })

  test('the other verb’s success output is not a success', () => {
    const launched = recorded('vega-device-launch-app/launched.txt')
    expect(
      parseDeviceAppCommand({ stdout: launched, stderr: '', exitCode: 0 }, 'uninstall')
    ).toMatchObject({ ok: false, kind: 'failed' })
  })

  test.each([
    [{ stdout: '', stderr: '', exitCode: 1 }, 'exit code 1'],
    [{ stdout: '', stderr: 'boom\nlast words\n', exitCode: 1 }, 'last words'],
    [{ stdout: '', stderr: '', exitCode: 0 }, 'exit code 0']
  ])('anything else fails with a reason: %o', (result, reason) => {
    expect(parseDeviceAppCommand(result, 'launch')).toEqual({ ok: false, kind: 'failed', reason })
  })
})
