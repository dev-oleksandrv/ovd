import { parseDevmodeLogin } from '../adapters/parseDevmodeLogin.js'
import { parseNodeVersion } from '../adapters/parseNodeVersion.js'
import { parseIsPortForwarded } from '../adapters/parseIsPortForwarded.js'
import { parseSdkConfigDoctor } from '../adapters/parseSdkConfigDoctor.js'
import { parseVdaVersion } from '../adapters/parseVdaVersion.js'
import type { Devices } from '../devices/devices.js'
import { VVD_ID } from '../devices/deviceModel.js'
import type { Device } from '../devices/types.js'
import { OvdError } from '../errors/ovdError.js'
import { vdaCmd, vegaCmd, vegaDeviceCmd } from '../sdk/commands.js'
import type { SdkInfo } from '../sdk/discoverSdk.js'
import type { Runner } from '../sdk/runner.js'
import type { SdkLocator } from '../sdk/sdkLocator.js'
import type { Vvd } from '../vvd/vvd.js'
import type { Check, CheckId, DoctorReport, HostInfo } from './types.js'

export interface DoctorDeps {
  runner: Runner
  sdk: SdkLocator
  devices: Devices
  vvd: Pick<Vvd, 'developerMode'>
  homedir: string
  // The user's login shell ($SHELL): it finds the Node that Metro and builds use.
  shell: string
  host: () => Promise<Omit<HostInfo, 'node'>>
  portInUse: (port: number) => Promise<boolean>
}

// Doctor only reports (spec C9): it never writes state or the activity log.
export interface Doctor {
  run(): Promise<DoctorReport>
}

const NAMES: Record<CheckId, string> = {
  sdk: 'Vega SDK',
  vda: 'VDA',
  devices: 'Devices',
  devmode: 'Developer Mode',
  metro: 'Metro',
  node: 'Node'
}
// Row labels: the main command each check runs. Metro runs it per port with `--port`,
// `--forward false` and `--device`; Devices also reads Virtual Device status and device info.
const COMMANDS: Partial<Record<CheckId, string>> = {
  sdk: 'vega sdk config doctor --json',
  vda: 'vega exec vda version',
  devices: 'vega exec vda devices -l',
  devmode: 'vega devmode login --json',
  metro: 'vega device is-port-forwarded',
  node: 'node --version'
}
const METRO_PORTS: readonly number[] = [8081, 8097]
const NODE_MAJOR = 22
// An interactive login shell loads the user's rc files (nvm and the like) first.
const NODE_TIMEOUT_MS = 5_000
// Signed in answers in 0.2 s; signed out prints `pending` at once and then waits for sign-in.
const DEVMODE_TIMEOUT_MS = 5_000

// A check names its command only when that command ran (commands shown are real).
type Result = Pick<Check, 'status' | 'detail'> & Partial<Pick<Check, 'hint' | 'fix' | 'command'>>

function check(id: CheckId, result: Result): Check {
  return { id, name: NAMES[id], ...result }
}

function ran(id: CheckId, result: Result): Result {
  const command = COMMANDS[id]
  return command === undefined ? result : { ...result, command }
}

function skipped(detail: string): Result {
  return { status: 'skipped', detail }
}

// A check that throws reports the error in its row; doctor itself never fails.
async function guarded(run: () => Promise<Result>, onError: Result['status']): Promise<Result> {
  try {
    return await run()
  } catch (error) {
    if (!(error instanceof OvdError)) throw error
    return { status: onError, detail: error.message, hint: error.hint }
  }
}

export function createDoctor(deps: DoctorDeps): Doctor {
  const tilde = (path: string) =>
    path.startsWith(`${deps.homedir}/`) ? `~${path.slice(deps.homedir.length)}` : path

  async function sdkCheck(): Promise<{ result: Result; sdk?: SdkInfo }> {
    let sdk: SdkInfo
    try {
      // Re-check must see an SDK installed while the app was open.
      sdk = await deps.sdk.rediscover()
    } catch (error) {
      if (!(error instanceof OvdError)) throw error
      return {
        result: { status: 'fail', detail: error.message, hint: error.hint, fix: 'install-sdk' }
      }
    }
    if (sdk.cli === 'bundled') {
      return {
        sdk,
        result: {
          status: 'fail',
          detail: 'Vega CLI (SDK Manager) not found — this vega is the one bundled with the SDK',
          hint: 'Install the Vega CLI (SDK Manager): https://developer.amazon.com/docs/vega/0.24/sdk-manager.html',
          fix: 'install-cli'
        }
      }
    }
    const result = await guarded(async () => {
      const run = await deps.runner.run(
        vegaCmd(sdk.vegaPath, ['sdk', 'config', 'doctor', '--json'])
      )
      const health = parseSdkConfigDoctor(run.stdout)
      const broken = health.corrupted + health.removed
      if (run.exitCode !== 0 || health.status !== 'success' || broken > 0) {
        return {
          status: 'warn',
          detail: `${broken} SDK component${broken === 1 ? '' : 's'} corrupted or removed`,
          hint: 'Repair it with vega sdk config doctor'
        }
      }
      return {
        status: 'ok',
        detail: `${sdk.sdkVersion} · Vega CLI ${sdk.cliVersion ?? '?'} · ${tilde(sdk.vegaPath)}`
      }
    }, 'warn')
    return { sdk, result: ran('sdk', result) }
  }

  async function vdaCheck(sdk: SdkInfo): Promise<Result> {
    const failed: Result = {
      status: 'fail',
      detail: 'vega exec vda version didn’t respond',
      hint: 'Start it with vega exec vda start-server, then re-check'
    }
    try {
      const run = await deps.runner.run(vdaCmd(sdk.vegaPath, ['version']))
      if (run.exitCode !== 0) return failed
      parseVdaVersion(run.stdout)
      return { status: 'ok', detail: 'Checked with vega exec vda version' }
    } catch (error) {
      if (!(error instanceof OvdError)) throw error
      return failed
    }
  }

  function devicesCheck(devices: Device[]): Result {
    const online = devices.filter((d) => d.status === 'online').length
    if (online === 0) {
      return {
        status: 'warn',
        detail: 'No devices connected',
        // ADR 0009: a stick without Developer Mode is invisible, so say so.
        hint: 'A Fire TV stick shows up only after Developer Mode is on. Start the Virtual Device or set up a stick.',
        fix: 'start-vvd'
      }
    }
    return { status: 'ok', detail: `${online} online · ${devices.length - online} unavailable` }
  }

  // A running Virtual Device with Developer Mode off takes over the row: it's the one thing
  // here OVD can fix in a click. Otherwise (or when it can't be read) the row is about sign-in.
  async function vvdDevmodeCheck(devices: Device[]): Promise<Result | null> {
    const vvd = devices.find((d) => d.id === VVD_ID)
    if (vvd?.status !== 'online') return null
    try {
      const { developerMode, command } = await deps.vvd.developerMode()
      if (developerMode) return null
      return {
        status: 'warn',
        detail: 'Developer Mode is off on the Virtual Device',
        command,
        hint: 'Turn it on with ovd vvd devmode enable',
        fix: 'enable-vvd-devmode'
      }
    } catch (error) {
      if (!(error instanceof OvdError)) throw error
      return null
    }
  }

  async function devmodeCheck(sdk: SdkInfo): Promise<Result> {
    const unknown: Result = { status: 'info', detail: 'Couldn’t check sign-in' }
    try {
      const run = await deps.runner.run({
        ...vegaCmd(sdk.vegaPath, ['devmode', 'login', '--json'], {
          timeoutMs: DEVMODE_TIMEOUT_MS
        }),
        // Stop at the pending answer: doctor must not leave a sign-in waiting.
        stopWhen: (stdout) => /"status"\s*:\s*"pending"/.test(stdout)
      })
      const login = parseDevmodeLogin(run.stdout)
      return login.signedIn
        ? {
            status: 'ok',
            detail:
              'Signed in to Amazon Developer Services · Developer Mode is required for a stick to appear'
          }
        : {
            status: 'warn',
            detail: 'Not signed in — needed to set up a new stick',
            hint: 'Sign in with vega devmode login',
            fix: 'setup-stick'
          }
    } catch (error) {
      if (!(error instanceof OvdError)) throw error
      return unknown
    }
  }

  async function metroCheck(sdk: SdkInfo, snapshot: { devices: Device[]; target: string | null }) {
    const inUse = (
      await Promise.all(METRO_PORTS.map(async (p) => ((await deps.portInUse(p)) ? p : null)))
    ).filter((p): p is number => p !== null)
    const host =
      inUse.length === 0
        ? `${METRO_PORTS.join(', ')} free on this computer`
        : `${inUse.join(', ')} in use on this computer`
    const target = snapshot.devices.find((d) => d.id === snapshot.target)
    if (!target || target.status !== 'online') {
      return { status: 'info', detail: `${host} · no target device` } satisfies Result
    }
    let reversed: number[]
    try {
      reversed = []
      for (const port of METRO_PORTS) {
        const run = await deps.runner.run(
          vegaDeviceCmd(
            sdk.vegaPath,
            'is-port-forwarded',
            ['--port', String(port), '--forward', 'false'],
            target.id
          )
        )
        if (run.exitCode !== 0) throw new OvdError('COMMAND_FAILED', run.stderr, '')
        if (parseIsPortForwarded(run.stdout)) reversed.push(port)
      }
    } catch (error) {
      if (!(error instanceof OvdError)) throw error
      return ran('metro', { status: 'info', detail: `${host} · couldn’t check ${target.name}` })
    }
    if (reversed.length === METRO_PORTS.length) {
      return ran('metro', {
        status: 'ok',
        detail: `${METRO_PORTS.join(', ')} reversed on ${target.name}`
      })
    }
    const where =
      reversed.length === 0
        ? `not reversed on ${target.name}`
        : `${reversed.join(', ')} reversed on ${target.name}`
    return ran('metro', { status: 'info', detail: `${host} · ${where}` })
  }

  // An app started from Finder or the Dock doesn't get the shell PATH, so `node` from the
  // app's own PATH would miss an nvm/fnm/Volta install; `-i` because nvm loads from ~/.zshrc.
  async function nodeCheck(): Promise<{ result: Result; node?: string }> {
    const hint = `Install Node ${NODE_MAJOR} or newer`
    const node = await deps.runner
      .run({
        file: deps.shell,
        args: ['-ilc', 'node --version'],
        display: 'node --version',
        timeoutMs: NODE_TIMEOUT_MS
      })
      .then((run) => (run.exitCode === 0 ? parseNodeVersion(run.stdout).version : undefined))
      // Not started, timed out, or no version line: all mean no Node this shell can run.
      .catch((error: unknown) => {
        if (!(error instanceof OvdError)) throw error
        return undefined
      })
    if (node === undefined) {
      return {
        result: ran('node', { status: 'warn', detail: 'Couldn’t find Node in your shell', hint })
      }
    }
    const major = Number(node.split('.')[0])
    const detail = `v${node} (requires ≥ ${NODE_MAJOR})`
    const result: Result =
      major >= NODE_MAJOR ? { status: 'ok', detail } : { status: 'fail', detail, hint }
    return { node, result: ran('node', result) }
  }

  return {
    async run() {
      const [host, { result: sdkResult, sdk }] = await Promise.all([deps.host(), sdkCheck()])
      const results: Partial<Record<CheckId, Result>> = { sdk: sdkResult }
      let devices: Device[] = []
      if (!sdk) {
        for (const id of ['vda', 'devices', 'devmode', 'metro'] as const) {
          results[id] = skipped('Waiting for the Vega SDK')
        }
      } else {
        results.vda = ran('vda', await vdaCheck(sdk))
        if (results.vda.status === 'fail') {
          results.devices = skipped('Waiting for VDA')
          results.metro = skipped('Waiting for VDA')
        } else {
          const snapshot = await deps.devices.list().then(
            (s) => s,
            (error: unknown) => {
              if (!(error instanceof OvdError)) throw error
              return error
            }
          )
          if (snapshot instanceof OvdError) {
            results.devices = ran('devices', {
              status: 'fail',
              detail: snapshot.message,
              hint: snapshot.hint
            })
            results.metro = skipped('Waiting for VDA')
          } else {
            devices = snapshot.devices
            results.devices = ran('devices', devicesCheck(snapshot.devices))
            results.metro = await metroCheck(sdk, snapshot)
          }
        }
        results.devmode =
          (await vvdDevmodeCheck(devices)) ??
          (sdk.cli === 'manager'
            ? ran('devmode', await devmodeCheck(sdk))
            : skipped('Needs the Vega CLI (SDK Manager)'))
      }
      const { result: nodeResult, node } = await nodeCheck()
      results.node = nodeResult
      const order: CheckId[] = ['sdk', 'vda', 'devices', 'devmode', 'metro', 'node']
      return {
        host: node === undefined ? host : { ...host, node },
        checks: order.flatMap((id) => {
          const result = results[id]
          return result ? [check(id, result)] : []
        })
      }
    }
  }
}
