import { setTimeout as delay } from 'node:timers/promises'
import type { ActivityLog } from '../activity/activityLog.js'
import { createLogged } from '../activity/logged.js'
import {
  parseVsmDeveloperMode,
  parseVsmDeveloperModeSet
} from '../adapters/parseVsmDeveloperMode.js'
import { VVD_ID } from '../devices/deviceModel.js'
import type { Devices } from '../devices/devices.js'
import type { Device } from '../devices/types.js'
import { OvdError, toErrorJson, type ErrorJson } from '../errors/ovdError.js'
import { vdaCmd, vegaCmd } from '../sdk/commands.js'
import type { Runner, RunResult } from '../sdk/runner.js'
import type { SdkLocator } from '../sdk/sdkLocator.js'
import type { Emulator } from './emulator.js'
import { isRetryable } from './emulatorConsole.js'

export interface VvdDeps {
  runner: Runner
  sdk: SdkLocator
  devices: Devices
  activity: ActivityLog
  emulator: Emulator
  // Injected so tests wait without real timers.
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export type VvdStatus = 'online' | 'starting' | 'stopped'

export interface VvdState {
  running: boolean
  status: VvdStatus
  // The Virtual Device as `ovd devices` lists it.
  device: Device
}

// Emulator gRPC after a start: turned on, or why not. A failure doesn't fail the start.
export type VvdGrpc = { status: 'on'; port: number } | { status: 'failed'; error: ErrorJson }

export type VvdStartResult = VvdState & { grpc: VvdGrpc }

// What doctor reports for emulator gRPC, read without changing anything.
export type VvdGrpcProbe =
  | { status: 'on'; port: number }
  | { status: 'off' }
  | { status: 'not-running' }
  | { status: 'starting' }

export interface Vvd {
  status(): Promise<VvdState>
  // Returns once VDA lists the Virtual Device online, with emulator gRPC turned on (ADR 0010).
  start(opts?: { signal?: AbortSignal }): Promise<VvdStartResult>
  stop(): Promise<VvdState>
  developerMode(): Promise<{ developerMode: boolean; command: string }>
  enableDeveloperMode(): Promise<{ developerMode: true }>
  // For a device the caller already read (doctor's snapshot), so nothing is listed twice.
  grpc(device: Device): Promise<VvdGrpcProbe>
}

// `start` returns after "Virtual device ready." (about 6 s); its own `--timeout` is 60 s.
const START_TIMEOUT_MS = 120_000
const STOP_TIMEOUT_MS = 30_000
const POLL_MS = 1_000
// VDA listed the device as soon as `start` returned in the recording; this covers slower hosts.
const LISTED_ATTEMPTS = 30
const UNLISTED_ATTEMPTS = 15
// VDA's name for the Virtual Device when it isn't listed yet.
const DEFAULT_VDA_SERIAL = 'emulator-5554'
// The console can lag behind VDA right after a start: about 10 s of attempts on connection
// errors (refused, closed, no answer), none on a refusal such as a wrong token.
const GRPC_ATTEMPTS = 10
const GRPC_RETRY_MS = 1_000

export function createVvd(deps: VvdDeps): Vvd {
  const logged = createLogged(deps.activity)
  const sleep = deps.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }))

  async function state(): Promise<VvdState> {
    const { devices } = await deps.devices.list()
    const device = devices.find((d) => d.id === VVD_ID)
    if (!device) {
      throw new OvdError(
        'VVD_NOT_INSTALLED',
        'The active Vega SDK has no Virtual Device',
        'Check the SDK install with ovd doctor'
      )
    }
    // A running Virtual Device that VDA doesn't list yet is still booting.
    const status: VvdStatus =
      device.status === 'online' ? 'online' : device.status === 'stopped' ? 'stopped' : 'starting'
    return { running: status !== 'stopped', status, device }
  }

  async function waitFor(
    done: (s: VvdState) => boolean,
    attempts: number,
    signal?: AbortSignal
  ): Promise<VvdState | null> {
    for (let i = 0; i < attempts; i++) {
      signal?.throwIfAborted()
      const s = await state()
      if (done(s)) return s
      await sleep(POLL_MS, signal)
    }
    return null
  }

  async function online(): Promise<{ vegaPath: string; vdaSerial: string }> {
    const s = await state()
    if (s.status !== 'online') {
      throw new OvdError(
        'TARGET_OFFLINE',
        'The Virtual Device is not running',
        'Start it with ovd vvd start'
      )
    }
    const { vegaPath } = await deps.sdk.get()
    return { vegaPath, vdaSerial: s.device.vdaSerial ?? DEFAULT_VDA_SERIAL }
  }

  // Its own activity entry; only an `OvdError` becomes a `failed` result, so an abort or a bug
  // still propagates.
  async function enableGrpc(started: VvdState, signal?: AbortSignal): Promise<VvdGrpc> {
    const port = deps.emulator.grpcPort
    const serial = started.device.vdaSerial ?? DEFAULT_VDA_SERIAL
    try {
      const on = await logged('vvd.grpc.enable', VVD_ID, { port: String(port) }, async () => {
        for (let attempt = 1; ; attempt++) {
          try {
            return await deps.emulator.enableGrpc(serial, signal ? { signal } : {})
          } catch (error) {
            if (!(error instanceof OvdError) || !isRetryable(error)) throw error
            if (attempt >= GRPC_ATTEMPTS) throw error
            await sleep(GRPC_RETRY_MS, signal)
          }
        }
      })
      return { status: 'on', port: on.port }
    } catch (error) {
      if (!(error instanceof OvdError)) throw error
      return { status: 'failed', error: toErrorJson(error) }
    }
  }

  return {
    status: state,

    async start(opts = {}) {
      const started = await logged('vvd.start', VVD_ID, {}, async () => {
        const before = await state()
        if (before.status === 'online') return before
        // `start` on a running Virtual Device exits 0 without starting anything
        // (fixtures/0.24/vega-virtual-device-start/already-running.stderr.txt), so only a
        // stopped one is started; a booting one is only waited for.
        if (before.status === 'stopped') {
          const { vegaPath } = await deps.sdk.get()
          const run = await deps.runner.run(
            vegaCmd(vegaPath, ['virtual-device', 'start'], {
              timeoutMs: START_TIMEOUT_MS,
              ...(opts.signal ? { signal: opts.signal } : {})
            })
          )
          if (run.exitCode !== 0) {
            throw new OvdError(
              'VVD_START_FAILED',
              'The Virtual Device didn’t start',
              'Run vega virtual-device start in a terminal to see why',
              { exitCode: run.exitCode, stderr: lastLine(run) }
            )
          }
        }
        const listed = await waitFor((s) => s.status === 'online', LISTED_ATTEMPTS, opts.signal)
        if (!listed) {
          throw new OvdError(
            'VVD_START_FAILED',
            'The Virtual Device started, but VDA doesn’t list it',
            'Restart it with ovd vvd stop, then ovd vvd start'
          )
        }
        return listed
      })
      return { ...started, grpc: await enableGrpc(started, opts.signal) }
    },

    stop() {
      return logged('vvd.stop', VVD_ID, {}, async () => {
        const before = await state()
        if (before.status === 'stopped') return before
        const { vegaPath } = await deps.sdk.get()
        const run = await deps.runner.run(
          vegaCmd(vegaPath, ['virtual-device', 'stop'], { timeoutMs: STOP_TIMEOUT_MS })
        )
        // Exit 1 "virtual device not running" means another surface stopped it first.
        if (run.exitCode !== 0 && !/not running/.test(run.stderr)) {
          throw new OvdError(
            'VVD_STOP_FAILED',
            'The Virtual Device didn’t stop',
            'Run vega virtual-device stop in a terminal to see why',
            { exitCode: run.exitCode, stderr: lastLine(run) }
          )
        }
        const stopped = await waitFor((s) => s.status === 'stopped', UNLISTED_ATTEMPTS)
        if (!stopped) {
          throw new OvdError(
            'VVD_STOP_FAILED',
            'The Virtual Device is still running',
            'Run vega virtual-device stop in a terminal to see why'
          )
        }
        return stopped
      })
    },

    async developerMode() {
      const { vegaPath, vdaSerial } = await online()
      const spec = vdaCmd(vegaPath, ['shell', 'vsm', 'developer-mode'], vdaSerial)
      const run = await deps.runner.run(spec)
      // Right after Developer Mode is turned off the device shell stops answering until the
      // Virtual Device restarts (fixtures/0.24/vsm-developer-mode/shell-service-down.stderr.txt).
      if (run.exitCode !== 0) {
        throw new OvdError(
          'COMMAND_FAILED',
          'Couldn’t read Developer Mode on the Virtual Device',
          'Restart the Virtual Device with ovd vvd stop, then ovd vvd start',
          { exitCode: run.exitCode, stderr: lastLine(run) }
        )
      }
      return { developerMode: parseVsmDeveloperMode(run.stdout).enabled, command: spec.display }
    },

    enableDeveloperMode() {
      return logged('vvd.devmode.enable', VVD_ID, {}, async () => {
        const { vegaPath, vdaSerial } = await online()
        const run = await deps.runner.run(
          vdaCmd(vegaPath, ['shell', 'vsm', 'developer-mode', 'enable'], vdaSerial)
        )
        if (run.exitCode !== 0 || !parseVsmDeveloperModeSet(run.stdout).enabled) {
          throw new OvdError(
            'VVD_DEVMODE_FAILED',
            'Developer Mode didn’t turn on',
            'Try again; if it keeps failing, restart the Virtual Device',
            { exitCode: run.exitCode, stderr: lastLine(run) }
          )
        }
        // `vega device info` reports the new `inDeveloperMode` on its next read.
        deps.devices.invalidate(VVD_ID)
        return { developerMode: true }
      })
    },

    async grpc(device) {
      if (device.status === 'stopped') return { status: 'not-running' }
      if (device.status !== 'online') return { status: 'starting' }
      return deps.emulator.grpc(device.vdaSerial ?? DEFAULT_VDA_SERIAL)
    }
  }
}

// The SDK logs to stderr before the actual error, which is the last line.
function lastLine(run: RunResult): string {
  return run.stderr.trim().split('\n').at(-1) ?? ''
}
