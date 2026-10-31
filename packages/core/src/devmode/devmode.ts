import { setTimeout as delay } from 'node:timers/promises'
import type { ActivityLog } from '../activity/activityLog.js'
import { createLogged } from '../activity/logged.js'
import {
  parseDevmodeLogin,
  parseDevmodeLoginPrompt,
  parseDevmodeResult,
  type LoginPrompt
} from '../adapters/parseDevmodeLogin.js'
import type { Devices } from '../devices/devices.js'
import type { Device } from '../devices/types.js'
import { OvdError } from '../errors/ovdError.js'
import { vegaCmd } from '../sdk/commands.js'
import type { Runner } from '../sdk/runner.js'
import type { SdkLocator } from '../sdk/sdkLocator.js'
import { normalizeCode } from './code.js'

export interface DevmodeDeps {
  runner: Runner
  sdk: SdkLocator
  devices: Devices
  activity: ActivityLog
  // Injected so tests wait without real timers.
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export interface EnableResult {
  enabled: true
  // The command OVD ran, as the wizard shows it.
  command: string
}

// Developer Mode on a new stick (Stage 1.5, ADR 0009): browser sign-in, the code from the TV,
// then the stick reboots and comes back on USB. OVD never sees or stores credentials.
export interface Devmode {
  signedIn(): Promise<boolean>
  // Resolves once signed in. When signed out, `onPrompt` gets the link and code to show while
  // `vega devmode login` waits for the browser; abort to give up.
  login(opts?: { signal?: AbortSignal; onPrompt?: (prompt: LoginPrompt) => void }): Promise<{
    signedIn: true
  }>
  enableDevice(opts: { code: string; vendor?: string }): Promise<EnableResult>
  // Resolves with the stick once it is back online on USB after `enableDevice`.
  waitForStick(opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<Device>
}

const PROBE_TIMEOUT_MS = 5_000
// `enable-device` answered in 1–4 s (fixtures/0.24/vega-devmode-enable-device).
const ENABLE_TIMEOUT_MS = 30_000
// The stick was back after 41 s in the recording; reboots vary, so allow plenty more.
export const STICK_WAIT_MS = 180_000
const POLL_MS = 2_000
// Right after the reboot `vega device info` prints empty fields; wait a little for them.
const INFO_ATTEMPTS = 5

// `vega devmode enable-device` exit codes: 2 and 6 are recorded; 3–5 come from the SDK docs.
const ENABLE_ERRORS: Record<number, () => OvdError> = {
  2: () => notSignedIn(),
  3: () =>
    new OvdError(
      'SESSION_EXPIRED',
      'The Amazon Developer sign-in has expired',
      'Sign in again with vega devmode login'
    ),
  4: () =>
    new OvdError(
      'NO_VENDORS',
      'This Amazon Developer account has no vendor',
      'Register as a developer in the Amazon Developer Console, then retry'
    ),
  5: () =>
    new OvdError(
      'VENDOR_REQUIRED',
      'This account has several vendors',
      'Pass the vendor ID: ovd setup-stick --vendor <id>'
    ),
  6: () =>
    new OvdError(
      'CODE_REJECTED',
      'The code is wrong or expired',
      'On the TV, open Developer Mode again to get a fresh code'
    )
}

export function createDevmode(deps: DevmodeDeps): Devmode {
  const logged = createLogged(deps.activity)
  const sleep = deps.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }))

  // `vega devmode` exists only in the Vega CLI, not in the `vega` bundled inside an SDK.
  async function managerPath(): Promise<string> {
    const sdk = await deps.sdk.get()
    if (sdk.cli !== 'manager') {
      throw new OvdError(
        'SDK_MANAGER_MISSING',
        'Setting up a stick needs the Vega CLI (SDK Manager)',
        'Install the Vega CLI, then check with ovd doctor'
      )
    }
    return sdk.vegaPath
  }

  async function onlineSticks(): Promise<Device[]> {
    const { devices } = await deps.devices.list()
    return devices.filter(
      (d) => d.kind === 'stick' && d.connection === 'usb' && d.status === 'online'
    )
  }

  return {
    async signedIn() {
      const vegaPath = await managerPath()
      const run = await deps.runner.run({
        ...vegaCmd(vegaPath, ['devmode', 'login', '--json'], { timeoutMs: PROBE_TIMEOUT_MS }),
        // A probe: stop at the pending answer rather than leave a sign-in waiting.
        stopWhen: (stdout) => parseDevmodeLoginPrompt(stdout) !== null
      })
      return parseDevmodeLogin(run.stdout).signedIn
    },

    async login(opts = {}) {
      const vegaPath = await managerPath()
      let prompted = false
      const run = await deps.runner.run({
        // No timeout: it waits as long as the user takes in the browser; the signal ends it.
        ...vegaCmd(vegaPath, ['devmode', 'login', '--json'], {
          timeoutMs: 0,
          ...(opts.signal ? { signal: opts.signal } : {})
        }),
        onStdout: (stdout) => {
          const prompt = prompted ? null : parseDevmodeLoginPrompt(stdout)
          if (prompt) {
            prompted = true
            opts.onPrompt?.(prompt)
          }
        }
      })
      // Exit 2 "Already logged in" (fixtures/0.24/vega-devmode-login/signed-in.json).
      if (run.exitCode === 2 && parseDevmodeLogin(run.stdout).signedIn) return { signedIn: true }
      const result = parseDevmodeResult('vega devmode login', run.stdout)
      if (run.exitCode !== 0 || !result.ok) throw notSignedIn()
      return { signedIn: true }
    },

    enableDevice(opts) {
      return logged('devmode.enable', null, {}, async () => {
        const code = normalizeCode(opts.code)
        const vendor = opts.vendor?.trim()
        const vegaPath = await managerPath()
        const args = ['devmode', 'enable-device', '--code', code]
        if (vendor) args.push('--vendor', vendor)
        const spec = vegaCmd(vegaPath, [...args, '--json'], { timeoutMs: ENABLE_TIMEOUT_MS })
        const run = await deps.runner.run(spec)
        const result = parseDevmodeResult('vega devmode enable-device', run.stdout)
        if (!result.ok) {
          const error = ENABLE_ERRORS[result.errorCode]
          throw error
            ? error()
            : new OvdError(
                'COMMAND_FAILED',
                result.message,
                'Run vega devmode enable-device in a terminal to see why',
                { exitCode: run.exitCode }
              )
        }
        // Shown without `--json`: it is the command a user would type.
        return { enabled: true, command: ['vega', ...args].join(' ') }
      })
    },

    async waitForStick(opts = {}) {
      const attempts = Math.ceil((opts.timeoutMs ?? STICK_WAIT_MS) / POLL_MS)
      // A brand-new stick's serial is unknown. Sticks online when the wait starts only count
      // once they have left the list: the one rebooting leaves it within seconds.
      const waiting = new Set((await onlineSticks()).map((d) => d.id))
      for (let attempt = 1; ; attempt++) {
        opts.signal?.throwIfAborted()
        const online = await onlineSticks()
        const ids = new Set(online.map((d) => d.id))
        for (const id of waiting) if (!ids.has(id)) waiting.delete(id)
        const back = online.find((d) => !waiting.has(d.id))
        if (back) return withInfo(back, opts.signal)
        if (attempt >= attempts) {
          throw new OvdError(
            'DEVICE_NOT_FOUND',
            'No new stick appeared on USB',
            'Plug the stick into this computer over USB and wait for the home screen, then retry'
          )
        }
        await sleep(POLL_MS, opts.signal)
      }
    }
  }

  async function withInfo(device: Device, signal?: AbortSignal): Promise<Device> {
    let current = device
    for (let i = 0; i < INFO_ATTEMPTS && !current.info; i++) {
      await sleep(POLL_MS, signal)
      current = (await onlineSticks()).find((d) => d.id === device.id) ?? current
    }
    return current
  }
}

function notSignedIn(): OvdError {
  return new OvdError(
    'NOT_SIGNED_IN',
    'Not signed in to Amazon Developer Services',
    'Sign in again and keep the browser tab open until it says you can return'
  )
}
