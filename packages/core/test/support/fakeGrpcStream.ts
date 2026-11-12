import { EventEmitter } from 'node:events'
import type { ClientHttp2Session, OutgoingHttpHeaders } from 'node:http2'
import { Readable } from 'node:stream'
import { frame } from '../../src/vvd/grpcWire.js'
import { fixture } from './fixtures.js'

interface RecordedStream {
  headers: Record<string, string | number>
  messages: string[]
  trailers: Record<string, string>
}

// fixtures/0.24/emulator-grpc/stream-screenshot.json: three RGBA8888 64x36 frames and the
// trailers of a Virtual Device that stopped.
export function recordedStream(): {
  headers: Record<string, string | number>
  messages: Uint8Array[]
  trailers: Record<string, string>
} {
  const recorded = JSON.parse(
    fixture('0.24/emulator-grpc/stream-screenshot.json')
  ) as RecordedStream
  return {
    headers: recorded.headers,
    messages: recorded.messages.map((hex) => new Uint8Array(Buffer.from(hex, 'hex'))),
    trailers: recorded.trailers
  }
}

// The server side of one `streamScreenshot` request: the test sends what the emulator would.
// The response body is a real `Readable`, so the client's `pause` holds data back as HTTP/2
// flow control does.
export interface FakeScreenStream {
  headers: OutgoingHttpHeaders
  body: Buffer
  respond(headers: Record<string, string | number>): void
  // Raw body bytes (framed messages, possibly split or joined).
  write(bytes: Uint8Array): void
  // One framed message.
  send(message: Uint8Array): void
  end(trailers?: Record<string, string>): void
  // The stream fails, as on a reset.
  fail(code: string): void
  paused(): boolean
}

export interface FakeSession {
  closed: boolean
  destroyed: boolean
  // Fires `error` on the session (a refused connection).
  error(code: string): void
  // GOAWAY, then the session closes.
  close(): void
}

export function fakeGrpcStream() {
  const streams: FakeScreenStream[] = []
  const sessions: FakeSession[] = []
  const connect = (_authority: string): ClientHttp2Session => {
    const session = new EventEmitter()
    const state: FakeSession = {
      closed: false,
      destroyed: false,
      error: (code) => session.emit('error', Object.assign(new Error(code), { code })),
      close: () => {
        session.emit('goaway')
        session.emit('close')
      }
    }
    sessions.push(state)
    const fake = Object.assign(session, {
      close: () => void (state.closed = true),
      destroy: () => void (state.destroyed = true),
      request: (headers: OutgoingHttpHeaders) => {
        const body = new Readable({ read: () => undefined })
        const server: FakeScreenStream = {
          headers,
          body: Buffer.alloc(0),
          respond: (h) => body.emit('response', h),
          write: (bytes) => void body.push(Buffer.from(bytes)),
          send: (message) => void body.push(Buffer.from(frame(message))),
          end: (trailers) => {
            if (trailers) body.emit('trailers', trailers)
            body.push(null)
          },
          fail: (code) => void body.destroy(Object.assign(new Error(code), { code })),
          paused: () => body.isPaused()
        }
        streams.push(server)
        return Object.assign(body, {
          end: (data: Uint8Array) => void (server.body = Buffer.from(data))
        })
      }
    })
    // A test double: only the members the client uses exist.
    return fake as unknown as ClientHttp2Session
  }
  return { connect, streams, sessions }
}
