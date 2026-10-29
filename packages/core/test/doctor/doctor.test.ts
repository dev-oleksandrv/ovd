import { describe, expect, test } from 'vitest'
import {
  createDoctor,
  createSdkLocator,
  OvdError,
  type Check,
  type Device,
  type Devices,
  type DevicesSnapshot,
  type SdkInfo
} from '../../src/index.js'
import { FakeRunner } from '../support/fakeRunner.js'
import { fixture } from '../support/fixtures.js'

const SDK_DOCTOR = 'vega sdk config doctor --json'
const VDA_VERSION = 'vega exec vda version'
const DEVMODE = 'vega devmode login --json'
const forwarded = (id: string, port: number) =>
  `vega device is-port-forwarded --port ${port} --forward false --device ${id}`

const out = (path: string) => ({ stdout: fixture(`0.24/${path}`) })

const manager: SdkInfo = {
  vegaPath: '/home/dev/vega/bin/vega',
  cli: 'manager',
  sdkVersion: '0.24.12112',
  cliVersion: '1.4.5'
}
const bundled: SdkInfo = {
  vegaPath: '/home/dev/vega/sdk/0.24.12112/bin/vega',
  cli: 'bundled',
  sdkVersion: '0.24.12112'
}

const stick: Device = {
  id: 'G4N0AB1234567',
  serial: 'G4N0AB1234567',
  name: 'Fire TV Stick 4K Select',
  kind: 'stick',
  connection: 'usb',
  status: 'online',
  isTarget: true,
  saved: false
}
const vvd: Device = {
  id: 'VirtualDevice',
  serial: 'VirtualDevice',
  name: 'Vega Virtual Device',
  kind: 'vvd',
  connection: 'local',
  status: 'stopped',
  isTarget: false,
  saved: false
}

const healthy = () => ({
  [SDK_DOCTOR]: out('vega-sdk-config-doctor/ok.json'),
  [VDA_VERSION]: out('vda-version/ok.txt'),
  [DEVMODE]: { ...out('vega-devmode-login/signed-in.json'), exitCode: 2 },
  [forwarded(stick.id, 8081)]: out('vega-device-is-port-forwarded/false.txt'),
  [forwarded(stick.id, 8097)]: out('vega-device-is-port-forwarded/false.txt')
})

interface Setup {
  script?: ConstructorParameters<typeof FakeRunner>[0]
  sdk?: SdkInfo | OvdError
  snapshot?: DevicesSnapshot | OvdError
  inUse?: number[]
  node?: string
}

function setup(opts: Setup = {}) {
  const runner = new FakeRunner(opts.script ?? healthy())
  const discovered: string[] = []
  const sdk = createSdkLocator(async () => {
    discovered.push('discover')
    const found = opts.sdk ?? manager
    if (found instanceof OvdError) throw found
    return found
  })
  const forbidden = (name: string) => () => {
    throw new Error(`doctor must not call devices.${name}`)
  }
  const devices: Devices = {
    list: async () => {
      const snapshot = opts.snapshot ?? { devices: [stick, vvd], target: stick.id }
      if (snapshot instanceof OvdError) throw snapshot
      return snapshot
    },
    currentTarget: forbidden('currentTarget'),
    get: forbidden('get'),
    rename: forbidden('rename'),
    setTarget: forbidden('setTarget')
  }
  const doctor = createDoctor({
    runner,
    sdk,
    devices,
    homedir: '/home/dev',
    host: async () => ({
      os: 'macOS',
      osVersion: '26.6',
      arch: 'arm64',
      node: opts.node ?? '24.2.0'
    }),
    portInUse: async (port) => (opts.inUse ?? []).includes(port)
  })
  return { doctor, runner, discovered, sdk }
}

const statuses = (checks: { status: string }[]) => checks.map((c) => c.status)
const check = (checks: Check[], id: string) => checks.find((c) => c.id === id)

describe('Doctor.run', () => {
  test('a healthy setup', async () => {
    const { doctor } = setup()
    const report = await doctor.run()
    expect(report.host).toEqual({ os: 'macOS', osVersion: '26.6', arch: 'arm64', node: '24.2.0' })
    expect(report.checks.map((c) => c.id)).toEqual([
      'sdk',
      'vda',
      'devices',
      'devmode',
      'metro',
      'node'
    ])
    expect(statuses(report.checks)).toEqual(['ok', 'ok', 'ok', 'ok', 'info', 'ok'])
    expect(report.checks).toMatchObject([
      {
        name: 'Vega SDK',
        detail: '0.24.12112 · Vega CLI 1.4.5 · ~/vega/bin/vega',
        command: SDK_DOCTOR
      },
      { name: 'VDA', detail: 'Checked with vega exec vda version', command: VDA_VERSION },
      {
        name: 'Devices',
        detail: '1 online · 1 unavailable',
        command: 'vega exec vda devices -l'
      },
      {
        name: 'Developer Mode',
        detail:
          'Signed in to Amazon Developer Services · Developer Mode is required for a stick to appear',
        command: DEVMODE
      },
      {
        name: 'Metro',
        detail: '8081, 8097 free on this computer · not reversed on Fire TV Stick 4K Select',
        command: 'vega device is-port-forwarded'
      },
      { name: 'Node', detail: 'v24.2.0 (requires ≥ 22)' }
    ])
    expect(check(report.checks, 'node')).not.toHaveProperty('command')
  })

  test('re-discovers the SDK on every run', async () => {
    const { doctor, discovered, sdk } = setup()
    await sdk.get()
    await doctor.run()
    expect(discovered).toHaveLength(2)
  })

  test('no SDK: the SDK fails and every SDK check waits for it', async () => {
    const { doctor, runner } = setup({
      sdk: new OvdError('SDK_NOT_FOUND', 'No Vega SDK found', 'Install the Vega SDK')
    })
    const { checks } = await doctor.run()
    expect(check(checks, 'sdk')).toMatchObject({
      status: 'fail',
      detail: 'No Vega SDK found',
      hint: 'Install the Vega SDK',
      fix: 'install-sdk'
    })
    for (const id of ['vda', 'devices', 'devmode', 'metro']) {
      expect(check(checks, id)).toMatchObject({
        status: 'skipped',
        detail: 'Waiting for the Vega SDK'
      })
    }
    expect(check(checks, 'node')?.status).toBe('ok')
    expect(runner.calls).toEqual([])
    // Only commands that ran are shown (architecture rule: commands shown are real).
    expect(checks.filter((c) => c.command !== undefined)).toEqual([])
  })

  test('only the SDK-bundled vega: SDK fails, sign-in is skipped, VDA and devices run', async () => {
    const { doctor } = setup({ sdk: bundled })
    const { checks } = await doctor.run()
    expect(check(checks, 'sdk')).toMatchObject({
      status: 'fail',
      detail: 'Vega CLI (SDK Manager) not found — this vega is the one bundled with the SDK',
      fix: 'install-cli'
    })
    expect(check(checks, 'sdk')?.hint).toBeTruthy()
    expect(check(checks, 'devmode')).toMatchObject({
      status: 'skipped',
      detail: 'Needs the Vega CLI (SDK Manager)'
    })
    expect(statuses(checks).slice(1, 3)).toEqual(['ok', 'ok'])
    expect(check(checks, 'sdk')).not.toHaveProperty('command')
    expect(check(checks, 'devmode')).not.toHaveProperty('command')
  })

  test('corrupted SDK components warn', async () => {
    const { doctor } = setup({
      script: {
        ...healthy(),
        [SDK_DOCTOR]: {
          stdout:
            '{"status":"success","validatedComponents":1,"corruptedComponents":1,"removedComponents":0}'
        }
      }
    })
    const { checks } = await doctor.run()
    expect(check(checks, 'sdk')).toMatchObject({
      status: 'warn',
      detail: '1 SDK component corrupted or removed',
      hint: 'Repair it with vega sdk config doctor'
    })
  })

  test('VDA not responding: VDA fails, devices and Metro wait for it', async () => {
    const { doctor } = setup({ script: { ...healthy(), [VDA_VERSION]: { exitCode: 1 } } })
    const { checks } = await doctor.run()
    expect(check(checks, 'vda')).toMatchObject({
      status: 'fail',
      detail: 'vega exec vda version didn’t respond',
      hint: 'Start it with vega exec vda start-server, then re-check'
    })
    for (const id of ['devices', 'metro']) {
      expect(check(checks, id)).toMatchObject({ status: 'skipped', detail: 'Waiting for VDA' })
      expect(check(checks, id)).not.toHaveProperty('command')
    }
    expect(check(checks, 'vda')?.command).toBe(VDA_VERSION)
    expect(check(checks, 'devmode')?.status).toBe('ok')
  })

  test('no device online warns and points to the Virtual Device', async () => {
    const { doctor } = setup({ snapshot: { devices: [vvd], target: null } })
    const { checks } = await doctor.run()
    expect(check(checks, 'devices')).toMatchObject({
      status: 'warn',
      detail: 'No devices connected',
      fix: 'start-vvd'
    })
    expect(check(checks, 'devices')?.hint).toContain('Developer Mode')
  })

  test('a failing device list fails the devices check, not the run', async () => {
    const { doctor } = setup({
      snapshot: new OvdError('VDA_UNAVAILABLE', 'VDA is not available', 'Check VDA')
    })
    const { checks } = await doctor.run()
    expect(check(checks, 'devices')).toMatchObject({
      status: 'fail',
      detail: 'VDA is not available',
      hint: 'Check VDA'
    })
  })

  test('signed out: the probe stops at the pending answer and the row warns', async () => {
    const { doctor, runner } = setup({
      script: {
        ...healthy(),
        [DEVMODE]: { ...out('vega-devmode-login/signed-out.json'), exitCode: 143, stopped: true }
      }
    })
    const { checks } = await doctor.run()
    expect(check(checks, 'devmode')).toMatchObject({
      status: 'warn',
      detail: 'Not signed in — needed to set up a new stick',
      fix: 'setup-stick'
    })
    const probe = runner.calls.find((c) => c.display === DEVMODE)
    expect(probe?.timeoutMs).toBe(5000)
    expect(probe?.stopWhen?.(fixture('0.24/vega-devmode-login/signed-out.json'))).toBe(true)
    expect(probe?.stopWhen?.('{"status":')).toBe(false)
  })

  test('a sign-in probe that never answers is reported, not thrown', async () => {
    const { doctor } = setup({
      script: {
        ...healthy(),
        [DEVMODE]: new OvdError('COMMAND_FAILED', 'did not finish in time', 'retry', {
          timedOut: true
        })
      }
    })
    const { checks } = await doctor.run()
    expect(check(checks, 'devmode')).toMatchObject({
      status: 'info',
      detail: 'Couldn’t check sign-in'
    })
  })

  test.each(['no target', 'offline target'])(
    'Metro without an online target checks only this computer (%s)',
    async (situation) => {
      const target = situation === 'no target' ? null : { ...stick, status: 'offline' as const }
      const { doctor, runner } = setup({
        snapshot: { devices: target ? [target, vvd] : [vvd], target: target?.id ?? null },
        inUse: [8081]
      })
      const { checks } = await doctor.run()
      expect(check(checks, 'metro')).toMatchObject({
        status: 'info',
        detail: '8081 in use on this computer · no target device'
      })
      expect(check(checks, 'metro')).not.toHaveProperty('command')
      expect(runner.calls.some((c) => c.display.includes('is-port-forwarded'))).toBe(false)
    }
  )

  test('Metro is ok when both ports are reversed on the target', async () => {
    const { doctor } = setup({
      inUse: [8081, 8097],
      script: {
        ...healthy(),
        [forwarded(stick.id, 8081)]: { stdout: 'true\n' },
        [forwarded(stick.id, 8097)]: { stdout: 'true\n' }
      }
    })
    const { checks } = await doctor.run()
    expect(check(checks, 'metro')).toMatchObject({
      status: 'ok',
      detail: '8081, 8097 reversed on Fire TV Stick 4K Select'
    })
  })

  test('Metro with one port reversed', async () => {
    const { doctor } = setup({
      inUse: [8097],
      script: { ...healthy(), [forwarded(stick.id, 8081)]: { stdout: 'true\n' } }
    })
    const { checks } = await doctor.run()
    expect(check(checks, 'metro')?.detail).toBe(
      '8097 in use on this computer · 8081 reversed on Fire TV Stick 4K Select'
    )
  })

  test('Node older than 22 fails', async () => {
    const { doctor } = setup({ node: '20.11.0' })
    const { checks } = await doctor.run()
    expect(check(checks, 'node')).toMatchObject({
      status: 'fail',
      detail: 'v20.11.0 (requires ≥ 22)',
      hint: 'Install Node 22 or newer'
    })
  })
})
