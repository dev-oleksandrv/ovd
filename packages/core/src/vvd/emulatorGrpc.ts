import type { ClientHttp2Session, IncomingHttpHeaders } from 'node:http2'
import { OvdError } from '../errors/ovdError.js'
import {
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
export type GrpcMethod = 'getVmState' | 'sendKey'

const SERVICE = '/android.emulation.control.EmulatorController'
const TIMEOUT_MS = 3_000
const UNAUTHENTICATED = '16'

export interface EmulatorGrpc {
  vmState(): Promise<{ state: number; running: boolean }>
  // An evdev key code (`KEY_BACK` is 158), pressed or released.
  sendKey(keyCode: number, eventType: KeyEventType): Promise<void>
}

export interface EmulatorGrpcOptions {
  port: number
  // `grpc.token` from the discovery file. Never logged and never put in an error.
  token: string
  connect: Http2Connect
  timeoutMs?: number
}

function grpcError(message: string, details: Record<string, unknown> = {}): OvdError {
  return new OvdError('VVD_GRPC_FAILED', message, 'Turn it on with ovd vvd start', details)
}

// gRPC over h2c on 127.0.0.1 with the discovery file's Bearer token (ADR 0010).
export function createEmulatorGrpc(opts: EmulatorGrpcOptions): EmulatorGrpc {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS

  function unary(method: GrpcMethod, message: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      let settled = false
      const session = opts.connect(`http://127.0.0.1:${opts.port}`)
      const finish = (error: OvdError | null, value?: Uint8Array) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) session.destroy()
        else session.close()
        if (error) reject(error)
        else resolve(value ?? new Uint8Array())
      }
      const timer = setTimeout(
        () => finish(grpcError(`Emulator gRPC didn’t answer ${method} in time`)),
        timeoutMs
      )
      session.on('error', (error: NodeJS.ErrnoException) =>
        finish(
          grpcError(`Couldn’t reach emulator gRPC on port ${opts.port}`, { cause: error.code })
        )
      )
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

  return {
    async vmState() {
      const message = await unary('getVmState', new Uint8Array())
      try {
        return decodeVmRunState(message)
      } catch {
        throw grpcError('Could not read the emulator gRPC getVmState answer')
      }
    },
    async sendKey(keyCode, eventType) {
      await unary('sendKey', encodeKeyboardEvent(keyCode, eventType))
    }
  }
}
