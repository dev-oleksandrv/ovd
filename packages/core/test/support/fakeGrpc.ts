import { EventEmitter } from 'node:events'
import type { ClientHttp2Session, OutgoingHttpHeaders } from 'node:http2'
import { fixture } from './fixtures.js'

interface Recorded {
  headers: Record<string, string | number>
  trailers: Record<string, string>
  body: string
}

export type GrpcAnswer =
  | 'get-vm-state-running.json'
  | 'get-vm-state-unauthenticated.json'
  | 'send-key.json'
  // Never answers.
  | 'silent'
  // The session fails, as `http2.connect` to a closed port does.
  | 'refused'

export interface GrpcRequest {
  authority: string
  headers: OutgoingHttpHeaders
  body: Buffer
}

// An `http2.connect` stand-in that replays the gRPC recordings (fixtures/0.24/emulator-grpc).
export function fakeGrpc(answer: (path: string) => GrpcAnswer) {
  const requests: GrpcRequest[] = []
  const sessions: { closed: boolean; destroyed: boolean }[] = []
  const connect = (authority: string): ClientHttp2Session => {
    const session = new EventEmitter()
    const state = { closed: false, destroyed: false }
    sessions.push(state)
    const fake = Object.assign(session, {
      close: () => void (state.closed = true),
      destroy: () => void (state.destroyed = true),
      request: (headers: OutgoingHttpHeaders) => {
        const stream = new EventEmitter()
        const end = (body: Uint8Array) => {
          requests.push({ authority, headers, body: Buffer.from(body) })
          const name = answer(String(headers[':path']))
          if (name === 'silent') return
          if (name === 'refused') {
            queueMicrotask(() =>
              session.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))
            )
            return
          }
          const recorded = JSON.parse(fixture(`0.24/emulator-grpc/${name}`)) as Recorded
          queueMicrotask(() => {
            stream.emit('response', recorded.headers)
            if (recorded.body) stream.emit('data', Buffer.from(recorded.body, 'hex'))
            if (Object.keys(recorded.trailers).length > 0) {
              stream.emit('trailers', recorded.trailers)
            }
            stream.emit('end')
            stream.emit('close')
          })
        }
        return Object.assign(stream, { end })
      }
    })
    // A test double: only the members the client uses exist.
    return fake as unknown as ClientHttp2Session
  }
  return { connect, requests, sessions }
}
