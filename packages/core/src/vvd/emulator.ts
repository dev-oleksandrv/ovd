import { connect as netConnect } from 'node:net'
import { connect as http2Connect } from 'node:http2'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { OvdError } from '../errors/ovdError.js'
import { consoleError, enableGrpc, type ConsoleConnect } from './emulatorConsole.js'
import { findDiscovery, processAlive } from './emulatorDiscovery.js'
import {
  createEmulatorGrpc,
  type EmulatorGrpc,
  type Http2Connect,
  type KeyEvent
} from './emulatorGrpc.js'

export type EmulatorGrpcState = { status: 'on'; port: number } | { status: 'off' }

// The Virtual Device's emulator endpoints: the console that turns gRPC on, and gRPC itself
// (ADR 0010). Ports come from VDA's serial (`emulator-5554` → console 5554) unless the env
// overrides them, which lets e2e sandboxes run side by side.
export interface Emulator {
  // The port `enableGrpc` asks for.
  grpcPort: number
  // Throws `VVD_GRPC_FAILED` (with `details.retryable` for a console that isn't up yet), or
  // an AbortError.
  enableGrpc(vdaSerial: string, opts?: { signal?: AbortSignal }): Promise<{ port: number }>
  // Read-only: whether gRPC answers `getVmState` with the discovery file's token.
  grpc(vdaSerial: string): Promise<EmulatorGrpcState>
  // Sends the key events over one gRPC session with the discovery file's token. Send only: with
  // gRPC off (no discovery file) it throws `VVD_GRPC_FAILED` with `details.off`, and the caller
  // decides whether to turn it on (`Vvd.ensureGrpc`).
  sendKeys(vdaSerial: string, events: KeyEvent[], opts?: { signal?: AbortSignal }): Promise<void>
  // A PNG of the screen over gRPC (`getScreenshot`), as `sendKeys` sends: with gRPC off it
  // throws `VVD_GRPC_FAILED` with `details.off`.
  screenshot(vdaSerial: string, opts?: { signal?: AbortSignal }): Promise<Uint8Array>
}

export interface EmulatorDeps {
  homedir: string
  env: Record<string, string | undefined>
  // Where the emulator writes its discovery file (`discoveryDirectories`).
  directories: string[]
  connect?: ConsoleConnect
  http2Connect?: Http2Connect
  isAlive?: (pid: number) => boolean
  readToken?: (file: string) => Promise<string>
  // Injected so tests wait without real timers.
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

const DEFAULT_CONSOLE_PORT = 5554
const DEFAULT_GRPC_PORT = 8554
const CONSOLE_TIMEOUT_MS = 5_000
// The discovery file appeared right after `grpc` answered in the recording; this covers slower
// hosts.
const DISCOVERY_WAIT_MS = 2_000
const DISCOVERY_POLL_MS = 200
const TOKEN_FILE = '.emulator_console_auth_token'
const RESTART_HINT = 'Restart the Virtual Device with ovd vvd stop, then ovd vvd start'

function envPort(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined
  const port = Number(value)
  return port > 0 && port < 65_536 ? port : undefined
}

export function createEmulator(deps: EmulatorDeps): Emulator {
  const connect: ConsoleConnect =
    deps.connect ?? ((port) => netConnect({ host: '127.0.0.1', port }))
  const h2: Http2Connect = deps.http2Connect ?? ((authority) => http2Connect(authority))
  const isAlive = deps.isAlive ?? processAlive
  const readToken = deps.readToken ?? ((file) => readFile(file, 'utf8'))
  const sleep = deps.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }))
  const grpcPort = envPort(deps.env.OVD_EMULATOR_GRPC_PORT) ?? DEFAULT_GRPC_PORT
  const discovery = { directories: deps.directories, isAlive }

  function consolePort(vdaSerial: string): number {
    return (
      envPort(deps.env.OVD_EMULATOR_CONSOLE_PORT) ??
      envPort(/^emulator-(\d+)$/.exec(vdaSerial)?.[1]) ??
      DEFAULT_CONSOLE_PORT
    )
  }

  async function token(): Promise<string> {
    let text: string
    try {
      text = await readToken(join(deps.homedir, TOKEN_FILE))
    } catch {
      throw consoleError(`~/${TOKEN_FILE} is missing or unreadable`, RESTART_HINT, false)
    }
    const value = text.trim()
    if (value === '') throw consoleError(`~/${TOKEN_FILE} is empty`, RESTART_HINT, false)
    return value
  }

  async function enable(vdaSerial: string, signal?: AbortSignal): Promise<{ port: number }> {
    const port = consolePort(vdaSerial)
    await enableGrpc({
      consolePort: port,
      grpcPort,
      token: await token(),
      connect,
      timeoutMs: CONSOLE_TIMEOUT_MS,
      ...(signal ? { signal } : {})
    })
    for (let waited = 0; ; waited += DISCOVERY_POLL_MS) {
      const found = await findDiscovery(discovery, port)
      if (found) return { port: found.grpcPort }
      if (waited >= DISCOVERY_WAIT_MS) {
        throw consoleError(
          'gRPC is on, but OVD can’t find the emulator’s discovery file',
          RESTART_HINT,
          false
        )
      }
      await sleep(DISCOVERY_POLL_MS, signal)
    }
  }

  // A client for the discovery file's port and token; off (`details.off`) without one.
  async function client(vdaSerial: string): Promise<EmulatorGrpc> {
    const found = await findDiscovery(discovery, consolePort(vdaSerial))
    if (!found) {
      throw new OvdError(
        'VVD_GRPC_FAILED',
        'Emulator gRPC is off',
        'Turn it on with ovd vvd start',
        {
          off: true
        }
      )
    }
    return createEmulatorGrpc({ port: found.grpcPort, token: found.token, connect: h2 })
  }

  return {
    grpcPort,

    async enableGrpc(vdaSerial, opts = {}) {
      try {
        return await enable(vdaSerial, opts.signal)
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error
        if (error instanceof OvdError && error.code === 'VVD_GRPC_FAILED') throw error
        // Anything else (an unreadable reply, a file system error) is still a failed enable,
        // and its text stays out: nothing that carries the token reaches an error.
        throw consoleError('Couldn’t turn on emulator gRPC', RESTART_HINT, false)
      }
    },

    async grpc(vdaSerial) {
      try {
        const found = await findDiscovery(discovery, consolePort(vdaSerial))
        if (!found) return { status: 'off' }
        await createEmulatorGrpc({
          port: found.grpcPort,
          token: found.token,
          connect: h2
        }).vmState()
        return { status: 'on', port: found.grpcPort }
      } catch {
        return { status: 'off' }
      }
    },

    async sendKeys(vdaSerial, events, opts = {}) {
      await (await client(vdaSerial)).sendKeys(events, opts)
    },

    async screenshot(vdaSerial, opts = {}) {
      return (await client(vdaSerial)).screenshot(opts)
    }
  }
}
