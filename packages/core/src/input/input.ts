import type { ActivityLog } from '../activity/activityLog.js'
import { createLogged, createPreflight } from '../activity/logged.js'
import { parseInputdPress, parseInputdText } from '../adapters/parseInputdReply.js'
import type { Devices } from '../devices/devices.js'
import { offline, onlineTarget } from '../devices/onlineTarget.js'
import type { Device } from '../devices/types.js'
import { OvdError } from '../errors/ovdError.js'
import type { Runner } from '../sdk/runner.js'
import type { SdkLocator } from '../sdk/sdkLocator.js'
import type { Emulator } from '../vvd/emulator.js'
import type { KeyEvent } from '../vvd/emulatorGrpc.js'
import type { Vvd } from '../vvd/vvd.js'
import { InputdConsoleError, openInputdConsole, type InputdConsole } from './inputdConsole.js'
import { GRPC_KEYS, INPUTD_KEYS, isRemoteKey, REMOTE_KEYS, type RemoteKey } from './keys.js'
import { pressEvents, sendEvents, textEvents } from './vvdInput.js'

export interface InputDeps {
  runner: Runner
  sdk: SdkLocator
  devices: Devices
  activity: ActivityLog
  emulator: Pick<Emulator, 'sendKeys'>
  vvd: Pick<Vvd, 'ensureGrpc'>
}

// Sticks go through `inputd-cli`, the Virtual Device through emulator gRPC (ADR 0010).
export type InputBackend = 'inputd-cli' | 'grpc'

export interface InputTarget {
  id: string
  name: string
}

export interface PressResult {
  target: InputTarget
  backend: InputBackend
  keys: RemoteKey[]
}

export interface TextResult {
  target: InputTarget
  backend: InputBackend
  text: string
  // In characters (code points), as validated.
  length: number
}

// One persistent session on one device: presses and texts go one at a time, in call order.
export interface InputSession {
  readonly target: InputTarget
  readonly backend: InputBackend
  press(keys: string[]): Promise<PressResult>
  text(text: string): Promise<TextResult>
  // Ends the console of a stick (`exit`, then its process group); nothing to end for gRPC.
  close(): Promise<void>
}

export interface InputOptions {
  device?: string
  // Ctrl+C: the session closes and the call rejects with an AbortError (not logged).
  signal?: AbortSignal
}

export interface Input {
  // Opens a session on the target (or `device`): for a stick, the console is up when it resolves.
  session(device?: string): Promise<InputSession>
  // `ovd input press <key...>`: a session for this one call.
  press(keys: string[], opts?: InputOptions): Promise<PressResult>
  // `ovd input text <text>`.
  text(text: string, opts?: InputOptions): Promise<TextResult>
}

export const MAX_TEXT_LENGTH = 500
// inputd-cli took about 0.3 s per `button_press` and 0.1 s per character of `send_text` on the
// Virtual Device (ARCHITECTURE §8).
const PRESS_TIMEOUT_MS = 10_000
const TEXT_TIMEOUT_MS = 5_000
const TEXT_PER_CHAR_MS = 150
const VVD_VDA_SERIAL = 'emulator-5554'
const CHECK_DEVICE = 'Check the device with ovd devices, then retry'
const CONTROL = /\p{Cc}/u
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/

export function backendOf(device: Device): InputBackend {
  return device.kind === 'vvd' ? 'grpc' : 'inputd-cli'
}

// Key names only; whether the device can take them is checked once it is known.
function knownKeys(keys: string[]): RemoteKey[] {
  if (keys.length === 0) {
    throw new OvdError('INVALID_KEY', 'No key given', `Keys: ${REMOTE_KEYS.join(', ')}`)
  }
  return keys.map((key) => {
    if (!isRemoteKey(key)) {
      throw new OvdError(
        'INVALID_KEY',
        `Unknown key: ${key.slice(0, 40)}`,
        `Keys: ${REMOTE_KEYS.join(', ')}`
      )
    }
    return key
  })
}

// Every key is checked before the first one is sent.
function keysFor(keys: string[], backend: InputBackend): RemoteKey[] {
  const known = knownKeys(keys)
  if (backend === 'grpc' && known.some((key) => GRPC_KEYS[key] === undefined)) {
    throw new OvdError(
      'KEY_UNSUPPORTED',
      'Home can’t be sent to the Virtual Device',
      'The emulator has no Home key; use Back or Menu'
    )
  }
  return known
}

// Messages never carry the text: it may be a password.
function textFor(text: string, backend: InputBackend): number {
  const length = [...text].length
  const invalid = (message: string, hint: string) => new OvdError('INVALID_TEXT', message, hint)
  if (length === 0)
    throw invalid('Nothing to type', 'Give the text to type, e.g. ovd input text "hello"')
  if (length > MAX_TEXT_LENGTH) {
    throw invalid(`The text is longer than ${MAX_TEXT_LENGTH} characters`, 'Send it in parts')
  }
  if (CONTROL.test(text)) {
    throw invalid(
      'The text has control characters (a newline or tab)',
      'Send each line on its own; press ok for Enter'
    )
  }
  if (backend === 'grpc' && !PRINTABLE_ASCII.test(text)) {
    throw invalid(
      'The Virtual Device only types printable ASCII',
      'Leave out accents, emoji and other non-ASCII characters'
    )
  }
  return length
}

// `send_text` splits on spaces in the console: the text goes in double quotes, with `"` and `\`
// escaped (ARCHITECTURE §8).
function sendTextLine(text: string): string {
  return `send_text "${text.replace(/[\\"]/g, (c) => `\\${c}`)}"`
}

function abortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

export function createInput(deps: InputDeps): Input {
  const logged = createLogged(deps.activity)
  const preflight = createPreflight(deps.activity)

  // The device as VDA lists it now; null when that can't be read.
  async function reread(device: Device): Promise<Device | null> {
    try {
      return await deps.devices.get(device.id)
    } catch (error) {
      if (!(error instanceof OvdError)) throw error
      return error.code === 'DEVICE_NOT_FOUND' ? { ...device, status: 'offline' } : null
    }
  }

  // A failure mid-session: an offline device is TARGET_OFFLINE, anything else INPUT_FAILED (or
  // the gRPC error as it is).
  async function failure(device: Device, error: unknown): Promise<never> {
    if (error instanceof InputdConsoleError) {
      const now = await reread(device)
      if (error.reason === 'not-found') throw offline({ ...(now ?? device), status: 'offline' })
      if (now && now.status !== 'online') throw offline(now)
      throw new OvdError(
        'INPUT_FAILED',
        error.reason === 'timeout'
          ? `inputd-cli on ${device.name} didn’t answer in time`
          : `The inputd-cli session on ${device.name} ended`,
        CHECK_DEVICE,
        { reason: error.reason }
      )
    }
    if (error instanceof OvdError && error.code !== 'TARGET_OFFLINE') {
      const now = await reread(device)
      if (now && now.status !== 'online') throw offline(now)
    }
    throw error
  }

  function createSession(
    device: Device
  ): InputSession & { open(): Promise<void>; abort(): Promise<void> } {
    const target = { id: device.id, name: device.name }
    const backend = backendOf(device)
    let inputdConsole: InputdConsole | undefined
    let closed = false
    let aborted = false
    // Ctrl+C: stops a gRPC sequence in flight.
    const stop = new AbortController()
    let queue: Promise<unknown> = Promise.resolve()
    const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
      const result = queue.then(run)
      queue = result.catch(() => undefined)
      return result
    }

    // The open console, or a new one when it ended (once per call).
    async function inputd(): Promise<InputdConsole> {
      if (inputdConsole && !inputdConsole.ended()) return inputdConsole
      const { vegaPath } = await deps.sdk.get()
      inputdConsole = await openInputdConsole({
        runner: deps.runner,
        vegaPath,
        vdaSerial: device.vdaSerial ?? device.id
      })
      // Ctrl+C while it opened.
      if (aborted) {
        await inputdConsole.stop()
        throw abortError()
      }
      return inputdConsole
    }

    async function grpc(events: KeyEvent[]): Promise<void> {
      const serial = device.vdaSerial ?? VVD_VDA_SERIAL
      try {
        await sendEvents(deps.emulator, serial, events, stop.signal)
      } catch (error) {
        if (aborted || !(error instanceof OvdError) || error.details?.off !== true) throw error
        // Off after a restart OVD didn't make: turned on once (and logged), then sent again.
        await deps.vvd.ensureGrpc(device)
        if (aborted) throw abortError()
        await sendEvents(deps.emulator, serial, events, stop.signal)
      }
    }

    const ensureOpen = () => {
      if (closed) {
        throw new OvdError(
          'INPUT_FAILED',
          'The input session is closed',
          'Open a new one, then retry'
        )
      }
    }

    async function attempt<T>(run: () => Promise<T>): Promise<T> {
      let result: T
      try {
        result = await run()
      } catch (error) {
        if (aborted) throw abortError()
        return failure(device, error)
      }
      // Ctrl+C while a send finished anyway: still a cancel, never a success.
      if (aborted) throw abortError()
      return result
    }

    return {
      target,
      backend,
      async open() {
        if (backend === 'inputd-cli') await attempt(inputd)
      },
      press(keys) {
        return enqueue(() =>
          logged('input.press', device.id, { keys: keys.join(','), backend }, async () => {
            const valid = keysFor(keys, backend)
            ensureOpen()
            await attempt(async () => {
              if (backend === 'grpc') return grpc(pressEvents(valid))
              const open = await inputd()
              for (const key of valid) {
                const name = INPUTD_KEYS[key]
                const reply = parseInputdPress(
                  await open.send(`button_press ${name}`, PRESS_TIMEOUT_MS),
                  name
                )
                if (!reply.ok) {
                  throw new OvdError(
                    'INPUT_FAILED',
                    `inputd-cli didn’t press ${key}: ${reply.message}`,
                    CHECK_DEVICE
                  )
                }
              }
            })
            return { target, backend, keys: valid }
          })
        )
      },
      text(text) {
        return enqueue(() => {
          // Only the length is logged, never the text.
          const args = { length: String([...text].length), backend }
          return logged('input.text', device.id, args, async () => {
            const length = textFor(text, backend)
            ensureOpen()
            await attempt(async () => {
              if (backend === 'grpc') return grpc(textEvents(text))
              const open = await inputd()
              const reply = parseInputdText(
                await open.send(sendTextLine(text), TEXT_TIMEOUT_MS + TEXT_PER_CHAR_MS * length)
              )
              if (!reply.ok) {
                throw new OvdError(
                  'INPUT_FAILED',
                  `inputd-cli didn’t type the text: ${reply.message}`,
                  CHECK_DEVICE
                )
              }
            })
            return { target, backend, text, length }
          })
        })
      },
      async close() {
        if (closed) return
        closed = true
        await queue
        await inputdConsole?.close()
      },
      async abort() {
        aborted = true
        closed = true
        stop.abort()
        await inputdConsole?.stop()
      }
    }
  }

  // One call on a session of its own; Ctrl+C closes it and rejects with an AbortError.
  async function oneShot<T>(
    action: 'input.press' | 'input.text',
    args: Record<string, string>,
    validate: () => void,
    opts: InputOptions,
    run: (session: InputSession) => Promise<T>
  ): Promise<T> {
    const device = await preflight(action, async (known) => {
      Object.assign(known.args, args)
      validate()
      const found = await onlineTarget(deps.devices, opts.device)
      known.target = found.id
      return found
    })
    if (opts.signal?.aborted) throw abortError()
    const session = createSession(device)
    const onAbort = () => void session.abort()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      return await run(session)
    } finally {
      opts.signal?.removeEventListener('abort', onAbort)
      await session.close()
    }
  }

  return {
    async session(override) {
      const device = await onlineTarget(deps.devices, override)
      const session = createSession(device)
      await session.open()
      return session
    },

    press(keys, opts = {}) {
      const args = { keys: keys.join(',') }
      return oneShot(
        'input.press',
        args,
        () => knownKeys(keys),
        opts,
        (s) => s.press(keys)
      )
    },

    text(text, opts = {}) {
      // The device decides what it takes; this only refuses what no device does.
      const args = { length: String([...text].length) }
      return oneShot(
        'input.text',
        args,
        () => textFor(text, 'inputd-cli'),
        opts,
        (s) => s.text(text)
      )
    }
  }
}
