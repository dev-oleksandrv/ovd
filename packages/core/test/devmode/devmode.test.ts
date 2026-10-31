import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  createActivityLog,
  createDevices,
  createDevmode,
  createSdkLocator,
  createStateStore,
  type ActivityEntry,
  type LoginPrompt
} from '../../src/index.js'
import { FakeRunner } from '../support/fakeRunner.js'
import { fixture } from '../support/fixtures.js'

const SERIAL = 'G070000000000001'
const VDA = 'vega exec vda devices -l'
const STATUS = 'vega virtual-device status'
const INFO = `vega device info --device ${SERIAL}`
const LOGIN = 'vega devmode login --json'
const ENABLE = 'vega devmode enable-device --code ABC123 --json'

const out = (path: string, exitCode = 0) => ({ stdout: fixture(`0.24/${path}`), exitCode })

const devices = {
  [STATUS]: out('vega-virtual-device-status/stopped.json'),
  [INFO]: out('vega-device-info/stick-usb.json')
}

let home: string

beforeEach(async () => {
  home = join(await mkdtemp(join(tmpdir(), 'ovd-devmode-')), 'ovd')
})

function setup(
  script: ConstructorParameters<typeof FakeRunner>[0],
  cli: 'manager' | 'bundled' = 'manager'
) {
  const runner = new FakeRunner(script)
  const sdk = createSdkLocator(async () => ({
    vegaPath: '/sdk/vega',
    cli,
    sdkVersion: '0.24.12112',
    cliVersion: '1.4.5'
  }))
  const activity = createActivityLog({ home, surface: 'cli' })
  const list = createDevices({ runner, sdk, state: createStateStore(home), activity, env: {} })
  const sleeps: number[] = []
  const devmode = createDevmode({
    runner,
    sdk,
    devices: list,
    activity,
    sleep: async (ms) => {
      sleeps.push(ms)
    }
  })
  return { devmode, runner, sleeps }
}

async function activity(): Promise<ActivityEntry[]> {
  const text = await readFile(join(home, 'activity.jsonl'), 'utf8')
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as ActivityEntry)
}

describe('signedIn', () => {
  test.each([
    ['vega-devmode-login/signed-in.json', 2, true],
    ['vega-devmode-login/signed-out.json', 143, false]
  ])('%s → %s', async (file, exitCode, expected) => {
    const { devmode, runner } = setup({ [LOGIN]: out(file, exitCode) })
    expect(await devmode.signedIn()).toBe(expected)
    // A probe never leaves a sign-in waiting.
    expect(runner.calls[0]?.stopWhen?.(fixture('0.24/vega-devmode-login/signed-out.json'))).toBe(
      true
    )
  })

  test('the SDK-bundled vega has no devmode', async () => {
    const { devmode } = setup({}, 'bundled')
    await expect(devmode.signedIn()).rejects.toMatchObject({ code: 'SDK_MANAGER_MISSING' })
  })
})

describe('login', () => {
  test('shows the link and code, then resolves once the browser sign-in finished', async () => {
    const { devmode, runner } = setup({
      [LOGIN]: out('vega-devmode-login/signed-in-after-browser.json')
    })
    const prompts: LoginPrompt[] = []
    expect(await devmode.login({ onPrompt: (p) => prompts.push(p) })).toEqual({ signedIn: true })
    expect(prompts).toEqual([
      { verificationUri: 'https://amazon.com/us/code?cbl-code=ABC123', userCode: 'ABC123' }
    ])
    // No timeout: the user takes as long as they need in the browser.
    expect(runner.calls[0]?.timeoutMs).toBe(0)
  })

  test('already signed in resolves at once without a prompt', async () => {
    const { devmode } = setup({ [LOGIN]: out('vega-devmode-login/signed-in.json', 2) })
    const prompts: LoginPrompt[] = []
    expect(await devmode.login({ onPrompt: (p) => prompts.push(p) })).toEqual({ signedIn: true })
    expect(prompts).toEqual([])
  })

  test('a sign-in that ends without success is NOT_SIGNED_IN', async () => {
    const { devmode } = setup({
      [LOGIN]: { stdout: '{"status":"error","errorCode":1,"errorMessage":"expired"}', exitCode: 1 }
    })
    await expect(devmode.login()).rejects.toMatchObject({ code: 'NOT_SIGNED_IN' })
  })

  test('passes the signal through, so closing the wizard stops the sign-in', async () => {
    const { devmode, runner } = setup({
      [LOGIN]: out('vega-devmode-login/signed-in-after-browser.json')
    })
    const controller = new AbortController()
    await devmode.login({ signal: controller.signal })
    expect(runner.calls[0]?.signal).toBe(controller.signal)
  })
})

describe('enableDevice', () => {
  test('runs enable-device with the normalized code and logs the action', async () => {
    const { devmode, runner } = setup({ [ENABLE]: out('vega-devmode-enable-device/enabled.json') })
    expect(await devmode.enableDevice({ code: ' abc-123 ' })).toEqual({
      enabled: true,
      command: 'vega devmode enable-device --code ABC123'
    })
    expect(runner.calls.map((c) => c.display)).toEqual([ENABLE])
    expect(await activity()).toMatchObject([
      { action: 'devmode.enable', target: null, args: {}, result: 'ok' }
    ])
  })

  test('passes --vendor', async () => {
    const { devmode } = setup({
      'vega devmode enable-device --code ABC123 --vendor M0000000000001 --json': out(
        'vega-devmode-enable-device/enabled.json'
      )
    })
    expect(await devmode.enableDevice({ code: 'ABC123', vendor: 'M0000000000001' })).toMatchObject({
      command: 'vega devmode enable-device --code ABC123 --vendor M0000000000001'
    })
  })

  test.each([
    ['vega-devmode-enable-device/invalid-code.json', 6, 'CODE_REJECTED'],
    ['vega-devmode-enable-device/not-signed-in.json', 2, 'NOT_SIGNED_IN']
  ])('%s → %s', async (file, exitCode, code) => {
    const { devmode } = setup({ [ENABLE]: out(file, exitCode) })
    await expect(devmode.enableDevice({ code: 'ABC123' })).rejects.toMatchObject({ code })
    expect(await activity()).toMatchObject([
      { action: 'devmode.enable', result: 'error', errorCode: code }
    ])
  })

  test.each([
    [3, 'SESSION_EXPIRED'],
    [4, 'NO_VENDORS'],
    [5, 'VENDOR_REQUIRED'],
    [9, 'COMMAND_FAILED']
  ])('error code %i → %s', async (errorCode, code) => {
    const { devmode } = setup({
      [ENABLE]: {
        stdout: JSON.stringify({ status: 'error', errorCode, errorMessage: 'x' }),
        exitCode: errorCode
      }
    })
    await expect(devmode.enableDevice({ code: 'ABC123' })).rejects.toMatchObject({ code })
  })

  test.each(['', 'ABC12', 'ABC1234', 'AB C1#3'])(
    '%j is INVALID_CODE without running',
    async (c) => {
      const { devmode, runner } = setup({})
      await expect(devmode.enableDevice({ code: c })).rejects.toMatchObject({
        code: 'INVALID_CODE'
      })
      expect(runner.calls).toEqual([])
    }
  )
})

describe('waitForStick', () => {
  const usb = out('vda-devices/stick-usb.txt')
  const none = out('vda-devices/none.txt')

  test('a stick that was not listed is found as soon as it appears', async () => {
    const { devmode, sleeps } = setup({ ...devices, [VDA]: [none, none, none, usb] })
    const device = await devmode.waitForStick()
    expect(device).toMatchObject({ id: SERIAL, connection: 'usb', status: 'online' })
    expect(device.info?.architecture).toBe('armv7')
    expect(sleeps).toEqual([2000, 2000])
  })

  test('a stick listed when the wait starts counts only once it has left and come back', async () => {
    const { devmode, runner } = setup({ ...devices, [VDA]: [usb, usb, none, none, usb] })
    expect(await devmode.waitForStick()).toMatchObject({ id: SERIAL })
    expect(runner.count(VDA)).toBe(5)
  })

  test('waits a little for the info a rebooted stick prints empty at first', async () => {
    const { devmode } = setup({
      ...devices,
      [VDA]: [none, usb],
      [INFO]: [out('vega-device-info/unavailable.json'), out('vega-device-info/stick-usb.json')]
    })
    expect((await devmode.waitForStick()).info?.architecture).toBe('armv7')
  })

  test('gives up with DEVICE_NOT_FOUND after the timeout', async () => {
    const { devmode, sleeps } = setup({ ...devices, [VDA]: none })
    await expect(devmode.waitForStick({ timeoutMs: 10_000 })).rejects.toMatchObject({
      code: 'DEVICE_NOT_FOUND'
    })
    expect(sleeps).toHaveLength(4)
  })

  test('stops when aborted', async () => {
    const { devmode } = setup({ ...devices, [VDA]: none })
    const controller = new AbortController()
    controller.abort()
    await expect(devmode.waitForStick({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError'
    })
  })
})
