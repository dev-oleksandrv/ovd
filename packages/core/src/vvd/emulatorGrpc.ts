import type { ClientHttp2Session, IncomingHttpHeaders } from 'node:http2'
import { OvdError } from '../errors/ovdError.js'
import {
  decodeImage,
  decodeVmRunState,
  encodeKeyboardEvent,
  frame,
  unframe,
  type KeyEventType
} from './grpcWire.js'

// `http2.connect` in production; tests pass a fake session.
export type Http2Connect = (authority: string) => ClientHttp2Session

// The only methods OVD calls. Never add `getStatus`: an authenticated `getStatus` call killed
// the Virtual Device (qemu exited) twice on SDK 0.24.12112 (ARCHITECTURE §8); `getVmState` is
// the probe instead.
export type GrpcMethod = 'getVmState' | 'sendKey' | 'getScreenshot'

const SERVICE = '/android.emulation.control.EmulatorController'
const TIMEOUT_MS = 3_000
// A native-size PNG (about 940 KB) took 345 ms on the Virtual Device (ARCHITECTURE §8).
const SCREENSHOT_TIMEOUT_MS = 10_000
const UNAUTHENTICATED = '16'

export interface KeyEvent {
  // An evdev key code (`KEY_BACK` is 158).
  keyCode: number
  eventType: KeyEventType
}

export interface EmulatorGrpc {
  vmState(): Promise<{ state: number; running: boolean }>
  sendKey(keyCode: number, eventType: KeyEventType): Promise<void>
  // Every event in order over ONE h2c session (a press or a typed text is a sequence of
  // events); the first failure ends it. The whole sequence gets 3 s + 50 ms per event.
  sendKeys(events: KeyEvent[], opts?: { signal?: AbortSignal }): Promise<void>
  // `getScreenshot` with an empty `ImageFormat` (PNG at the display's size): the PNG bytes.
  // 10 s, or an abort, ends it.
  screenshot(opts?: { signal?: AbortSignal }): Promise<Uint8Array>
}

export interface EmulatorGrpcOptions {
  port: number
  // `grpc.token` from the discovery file. Never logged and never put in an error.
  token: string
  connect: Http2Connect
  timeoutMs?: number
}

const PER_EVENT_MS = 50

function grpcError(message: string, details: Record<string, unknown> = {}): OvdError {
  return new OvdError('VVD_GRPC_FAILED', message, 'Turn it on with ovd vvd start', details)
}

type Call = (method: GrpcMethod, message: Uint8Array) => Promise<Uint8Array>

// gRPC over h2c on 127.0.0.1 with the discovery file's Bearer token (ADR 0010).
export function createEmulatorGrpc(opts: EmulatorGrpcOptions): EmulatorGrpc {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS

  // One request on an open session; rejects with VVD_GRPC_FAILED on any non-zero status.
  function request(
    session: ClientHttp2Session,
    method: GrpcMethod,
    message: Uint8Array
  ): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (error: OvdError | null, value?: Uint8Array) => {
        if (settled) return
        settled = true
        if (error) reject(error)
        else resolve(value ?? new Uint8Array())
      }
      const req = session.request({
        ':method': 'POST',
        ':path': `${SERVICE}/${method}`,
        'content-type': 'application/grpc',
        te: 'trailers',
        authorization: `Bearer ${opts.token}`
      })
      let headers: IncomingHttpHeaders = {}
      let trailers: IncomingHttpHeaders = {}
      const chunks: Buffer[] = []
      req.on('response', (h: IncomingHttpHeaders) => (headers = h))
      req.on('trailers', (t: IncomingHttpHeaders) => (trailers = t))
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('error', (error: NodeJS.ErrnoException) =>
        finish(grpcError(`Emulator gRPC ${method} failed`, { cause: error.code }))
      )
      req.on('end', () => {
        // A trailers-only answer (an error) carries the status in its headers.
        const status = String(trailers['grpc-status'] ?? headers['grpc-status'] ?? '')
        if (Number(headers[':status']) !== 200 || status === '') {
          finish(grpcError(`Emulator gRPC ${method} gave no gRPC status`))
          return
        }
        if (status === UNAUTHENTICATED) {
          finish(grpcError('Emulator gRPC rejected OVD’s token', { grpcStatus: status }))
          return
        }
        if (status !== '0') {
          finish(grpcError(`Emulator gRPC ${method} failed`, { grpcStatus: status }))
          return
        }
        try {
          finish(null, unframe(Buffer.concat(chunks))[0] ?? new Uint8Array())
        } catch {
          finish(grpcError(`Could not read the emulator gRPC ${method} answer`))
        }
      })
      req.on('close', () => finish(grpcError(`Emulator gRPC ${method} closed without an answer`)))
      req.end(frame(message))
    })
  }

  // Opens one session for `body`'s requests, closed when it resolves and destroyed on the first
  // error, a session error, the timeout or an abort.
  function withSession<T>(
    what: string,
    limitMs: number,
    signal: AbortSignal | undefined,
    body: (call: Call) => Promise<T>
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const session = opts.connect(`http://127.0.0.1:${opts.port}`)
      const onAbort = () => finish(abortError(signal))
      const finish = (error: Error | null, value?: T) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (error) {
          session.destroy()
          reject(error)
        } else {
          session.close()
          resolve(value as T)
        }
      }
      const timer = setTimeout(
        () => finish(grpcError(`Emulator gRPC didn’t answer ${what} in time`)),
        limitMs
      )
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      session.on('error', (error: NodeJS.ErrnoException) =>
        finish(
          grpcError(`Couldn’t reach emulator gRPC on port ${opts.port}`, { cause: error.code })
        )
      )
      body((method, message) => {
        if (settled) return Promise.reject(grpcError(`Emulator gRPC ${method} was stopped`))
        return request(session, method, message)
      }).then(
        (value) => finish(null, value),
        (error: unknown) => finish(error instanceof Error ? error : new Error(String(error)))
      )
    })
  }

  return {
    async vmState() {
      const message = await withSession('getVmState', timeoutMs, undefined, (call) =>
        call('getVmState', new Uint8Array())
      )
      try {
        return decodeVmRunState(message)
      } catch {
        throw grpcError('Could not read the emulator gRPC getVmState answer')
      }
    },
    async sendKey(keyCode, eventType) {
      await withSession('sendKey', timeoutMs, undefined, (call) =>
        call('sendKey', encodeKeyboardEvent(keyCode, eventType))
      )
    },
    async sendKeys(events, keyOpts = {}) {
      if (events.length === 0) return
      await withSession(
        'sendKey',
        timeoutMs + PER_EVENT_MS * events.length,
        keyOpts.signal,
        async (call) => {
          for (const event of events) {
            await call('sendKey', encodeKeyboardEvent(event.keyCode, event.eventType))
          }
        }
      )
    },
    async screenshot(shotOpts = {}) {
      const message = await withSession(
        'getScreenshot',
        SCREENSHOT_TIMEOUT_MS,
        shotOpts.signal,
        (call) => call('getScreenshot', new Uint8Array())
      )
      try {
        return decodeImage(message)
      } catch {
        throw grpcError('Could not read the emulator gRPC getScreenshot answer')
      }
    }
  }
}

function abortError(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason
  if (reason instanceof Error && reason.name === 'AbortError') return reason
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}
