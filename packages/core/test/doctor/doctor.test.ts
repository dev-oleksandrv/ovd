import { describe, expect, test } from 'vitest'
import {
  createDoctor,
  createSdkLocator,
  OvdError,
  type Check,
  type Device,
  type Devices,
  type ProjectMode,
  type DevicesSnapshot,
  type SdkInfo
} from '../../src/index.js'
import { FakeRunner } from '../support/fakeRunner.js'
import { fixture } from '../support/fixtures.js'

const SDK_DOCTOR = 'vega sdk config doctor --json'
const VDA_VERSION = 'vega exec vda version'
const DEVMODE = 'vega devmode login --json'
const NODE = 'node --version'
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
  [forwarded(stick.id, 8097)]: out('vega-device-is-port-forwarded/false.txt'),
  [NODE]: { stdout: 'v24.2.0\n' }
})

interface Setup {
  script?: ConstructorParameters<typeof FakeRunner>[0]
  sdk?: SdkInfo | OvdError
  snapshot?: DevicesSnapshot | OvdError
  inUse?: number[]
  // What `vvd.developerMode()` answers; it may only be asked while the Virtual Device is online.
  vvdDevmode?: boolean | OvdError
  // What `project.current()` answers; nothing open by default.
  project?: ProjectMode | null
}

const VSM = 'vega exec vda -s emulator-5554 shell vsm developer-mode'

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
    setTarget: forbidden('setTarget'),
    invalidate: forbidden('invalidate')
  }
  const vvdAsked: string[] = []
  const vvdDeps = {
    developerMode: async () => {
      vvdAsked.push('developerMode')
      const answer = opts.vvdDevmode ?? true
      if (answer instanceof OvdError) throw answer
      return { developerMode: answer, command: VSM }
    }
  }
  const doctor = createDoctor({
    runner,
    sdk,
    devices,
    vvd: vvdDeps,
    project: { current: async () => opts.project ?? null },
    homedir: '/home/dev',
    shell: '/bin/zsh',
    host: async () => ({ os: 'macOS', osVersion: '26.6', arch: 'arm64' }),
    portInUse: async (port) => (opts.inUse ?? []).includes(port)
  })
  return { doctor, runner, discovered, sdk, vvdAsked }
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
      'project',
      'devices',
      'devmode',
      'metro',
      'node'
    ])
    expect(statuses(report.checks)).toEqual(['ok', 'ok', 'info', 'ok', 'ok', 'info', 'ok'])
    expect(report.checks).toMatchObject([
      {
        name: 'Vega SDK',
        detail: '0.24.12112 · Vega CLI 1.4.5 · ~/vega/bin/vega',
        command: SDK_DOCTOR
      },
      { name: 'VDA', detail: 'Checked with vega exec vda version', command: VDA_VERSION },
      { name: 'Project', detail: 'No project open' },
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
      { name: 'Node', detail: 'v24.2.0 (requires ≥ 22)', command: NODE }
    ])
  })

  // An app started from Finder or the Dock doesn't get the shell PATH, so a bare `node`
  // would miss an nvm/fnm/Volta Node: ask the user's login shell, which Metro also runs in.
  test('Node is the one the login shell finds', async () => {
    const { doctor, runner } = setup()
    await doctor.run()
    expect(runner.calls.find((c) => c.display === NODE)).toMatchObject({
      file: '/bin/zsh',
      args: ['-ilc', 'node --version']
    })
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
    expect(runner.calls.map((c) => c.display)).toEqual([NODE])
    // Only commands that ran are shown (architecture rule: commands shown are real).
    expect(checks.filter((c) => c.command !== undefined).map((c) => c.id)).toEqual(['node'])
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
    expect([check(checks, 'vda')?.status, check(checks, 'devices')?.status]).toEqual(['ok', 'ok'])
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
    const { doctor } = setup({ script: { ...healthy(), [NODE]: { stdout: 'v20.11.0\n' } } })
    const { checks } = await doctor.run()
    expect(check(checks, 'node')).toMatchObject({
      status: 'fail',
      detail: 'v20.11.0 (requires ≥ 22)',
      hint: 'Install Node 22 or newer'
    })
  })

  test.each([
    ['not installed', { exitCode: 127, stderr: 'zsh: command not found: node' }],
    [
      'a shell that never answers',
      new OvdError('COMMAND_FAILED', 'node --version did not finish in time', 'Retry')
    ]
  ])('Node not found (%s) warns and the header leaves Node out', async (_, result) => {
    const { doctor } = setup({ script: { ...healthy(), [NODE]: result } })
    const report = await doctor.run()
    expect(check(report.checks, 'node')).toMatchObject({
      status: 'warn',
      detail: 'Couldn’t find Node in your shell',
      hint: 'Install Node 22 or newer',
      command: NODE
    })
    expect(report.host).not.toHaveProperty('node')
  })

  describe('Virtual Device Developer Mode', () => {
    const vvdOnline: Device = { ...vvd, status: 'online', vdaSerial: 'emulator-5554' }
    const snapshot = { devices: [stick, vvdOnline], target: stick.id }

    test('off: the row warns with a fix and the sign-in probe does not run', async () => {
      const { doctor, runner } = setup({ snapshot, vvdDevmode: false })
      const report = await doctor.run()
      expect(report.checks.find((c) => c.id === 'devmode')).toEqual({
        id: 'devmode',
        name: 'Developer Mode',
        status: 'warn',
        detail: 'Developer Mode is off on the Virtual Device',
        command: VSM,
        hint: 'Turn it on with ovd vvd devmode enable',
        fix: 'enable-vvd-devmode'
      })
      expect(runner.count(DEVMODE)).toBe(0)
    })

    test('on: the row is about sign-in', async () => {
      const { doctor, vvdAsked } = setup({ snapshot, vvdDevmode: true })
      const report = await doctor.run()
      expect(vvdAsked).toEqual(['developerMode'])
      expect(report.checks.find((c) => c.id === 'devmode')).toMatchObject({
        status: 'ok',
        command: DEVMODE
      })
    })

    test('unreadable: the row falls back to sign-in', async () => {
      const failure = new OvdError('COMMAND_FAILED', 'Couldn’t read Developer Mode', 'Restart it')
      const { doctor } = setup({ snapshot, vvdDevmode: failure })
      const report = await doctor.run()
      expect(report.checks.find((c) => c.id === 'devmode')).toMatchObject({ status: 'ok' })
    })

    test('stopped: Developer Mode is not read', async () => {
      const { doctor, vvdAsked } = setup({ vvdDevmode: false })
      await doctor.run()
      expect(vvdAsked).toEqual([])
    })
  })
})

describe('Doctor.run: Project row', () => {
  const PROJECT_DOCTOR = 'vega project doctor'
  const folder: ProjectMode = {
    kind: 'folder',
    path: '/home/dev/dev/hellovega',
    displayPath: '~/dev/hellovega',
    name: 'hellovega',
    osTarget: '1.2',
    rnVersion: '0.83'
  }
  const withProjectDoctor = (result: { stdout: string; stderr?: string; exitCode?: number }) => ({
    script: { ...healthy(), [PROJECT_DOCTOR]: result },
    project: folder
  })

  test('nothing open: info, and no command runs', async () => {
    const { doctor, runner } = setup()
    const { checks } = await doctor.run()
    expect(check(checks, 'project')).toEqual({
      id: 'project',
      name: 'Project',
      status: 'info',
      detail: 'No project open'
    })
    expect(runner.count(PROJECT_DOCTOR)).toBe(0)
  })

  test('a .vpkg open without a project: ok, naming the file', async () => {
    const { doctor, runner } = setup({
      project: {
        kind: 'vpkg',
        path: '/home/dev/Downloads/player-1.4.2-armv7.vpkg',
        displayPath: '~/Downloads/player-1.4.2-armv7.vpkg',
        file: 'player-1.4.2-armv7.vpkg'
      }
    })
    const { checks } = await doctor.run()
    expect(check(checks, 'project')).toMatchObject({
      status: 'ok',
      detail: 'No project open · installing from player-1.4.2-armv7.vpkg'
    })
    expect(runner.count(PROJECT_DOCTOR)).toBe(0)
  })

  test('runs vega project doctor in the project folder and keeps its result for Details', async () => {
    const stdout = fixture('0.24/vega-project-doctor/one-warning.txt')
    const { doctor, runner } = setup(withProjectDoctor({ stdout }))
    const { checks } = await doctor.run()
    expect(runner.calls.find((c) => c.display === PROJECT_DOCTOR)?.cwd).toBe(folder.path)
    const row = check(checks, 'project')
    expect(row).toMatchObject({
      status: 'warn',
      detail: 'vega project doctor · 0 errors, 1 warning',
      command: PROJECT_DOCTOR,
      hint: 'Remove unknown scoped packages or check OS version'
    })
    expect(row?.project?.checks).toHaveLength(10)
    expect(row?.project?.output).toBe(stdout)
  })

  test('failed checks fail the row, and stderr is kept in the output', async () => {
    const stdout = fixture('0.24/vega-project-doctor/failed.txt')
    const stderr = fixture('0.24/vega-project-doctor/failed.stderr.txt')
    const { doctor } = setup(withProjectDoctor({ stdout, stderr, exitCode: 1 }))
    const row = check((await doctor.run()).checks, 'project')
    expect(row).toMatchObject({
      status: 'fail',
      detail: 'vega project doctor · 2 checks failed, 2 warnings'
    })
    expect(row?.project?.output).toContain('is not minted')
  })

  test('one failed check names it', async () => {
    const stdout = fixture('0.24/vega-project-doctor/no-project.txt')
    const { doctor } = setup(withProjectDoctor({ stdout, exitCode: 1 }))
    expect(check((await doctor.run()).checks, 'project')).toMatchObject({
      status: 'fail',
      detail: 'vega project doctor · Missing OS Version and RN version'
    })
  })

  test('a folder that is no longer a project fails without running the command', async () => {
    const { doctor, runner } = setup({ project: { ...folder, missing: true } })
    const row = check((await doctor.run()).checks, 'project')
    expect(row).toMatchObject({
      status: 'fail',
      detail: '~/dev/hellovega is no longer a Vega project'
    })
    expect(row?.hint).toBeTruthy()
    expect(runner.count(PROJECT_DOCTOR)).toBe(0)
  })

  test('unreadable output warns instead of failing doctor', async () => {
    const { doctor } = setup(withProjectDoctor({ stdout: 'Usage: vega project doctor\n' }))
    expect(check((await doctor.run()).checks, 'project')).toMatchObject({
      status: 'warn',
      command: PROJECT_DOCTOR
    })
  })
})
