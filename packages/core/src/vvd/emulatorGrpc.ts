import type { ClientHttp2Session, ClientHttp2Stream, IncomingHttpHeaders } from 'node:http2'
import { OvdError } from '../errors/ovdError.js'
import {
  decodeImage,
  decodeImageFrame,
  decodeVmRunState,
  encodeImageFormat,
  encodeKeyboardEvent,
  frame,
  unframe,
  type ImageFormat,
  type KeyEventType,
  type ScreenFrame
} from './grpcWire.js'

// `http2.connect` in production; tests pass a fake session.
export type Http2Connect = (authority: string) => ClientHttp2Session

// The only methods OVD calls. Never add `getStatus`: an authenticated `getStatus` call killed
// the Virtual Device (qemu exited) twice on SDK 0.24.12112 (ARCHITECTURE §8); `getVmState` is
// the probe instead.
export type GrpcMethod = 'getVmState' | 'sendKey' | 'getScreenshot' | 'streamScreenshot'

const SERVICE = '/android.emulation.control.EmulatorController'
const TIMEOUT_MS = 3_000
// A native-size PNG (about 940 KB) took 345 ms on the Virtual Device (ARCHITECTURE §8).
const SCREENSHOT_TIMEOUT_MS = 10_000
const UNAUTHENTICATED = '16'
// The emulator sends the first frame at once (ARCHITECTURE §8); later ones only when the screen
// changes, so an idle screen sends nothing and there is no timeout after the first.
const FIRST_FRAME_TIMEOUT_MS = 10_000
// `UNAVAILABLE`, "Cancelling all calls": what an open stream gets when the Virtual Device stops.
const UNAVAILABLE = '14'

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
  // `streamScreenshot`: a frame at once, then one per screen change, on its own h2c session.
  streamScreenshot(format: ImageFormat, opts?: { signal?: AbortSignal }): FrameStream
}

// A live screen stream. At most one decoded frame waits in it: until `next` takes it, the
// stream stops reading, so HTTP/2 flow control holds the emulator back instead of frames piling
// up in memory.
export interface FrameStream {
  // The next frame; null once the stream ended (the Virtual Device stopped, the stream was
  // closed or aborted). Rejects with `VVD_GRPC_FAILED` when the stream failed (refused, an
  // HTTP or gRPC error status, a frame it can't read, no first frame in 10 s).
  next(): Promise<ScreenFrame | null>
  // Ends the stream and its session; a pending `next` resolves null. Idempotent.
  close(): void
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

  function streamScreenshot(format: ImageFormat, signal?: AbortSignal): FrameStream {
    const method: GrpcMethod = 'streamScreenshot'
    // Received bytes not yet parsed, as a chunk list with its length: frames of about 2 MB
    // arrive in many chunks, and concatenating on every chunk would be quadratic.
    const chunks: Buffer[] = []
    let buffered = 0
    let held: ScreenFrame | undefined
    // How the stream ended, delivered once the held frame is taken.
    let outcome: { error: OvdError | null } | undefined
    let done = false
    let waiter:
      { resolve: (f: ScreenFrame | null) => void; reject: (e: OvdError) => void } | undefined
    let pending: Promise<ScreenFrame | null> | undefined
    let headers: IncomingHttpHeaders | undefined
    let trailers: IncomingHttpHeaders = {}
    let firstFrame = false
    let req: ClientHttp2Stream | undefined
    const session = opts.connect(`http://127.0.0.1:${opts.port}`)

    const onAbort = () => end(null, true)
    const timer = setTimeout(
      () =>
        end(grpcError(`Emulator gRPC sent no screen frame in ${FIRST_FRAME_TIMEOUT_MS / 1000} s`)),
      FIRST_FRAME_TIMEOUT_MS
    )

    // Delivers what is ready to a waiting `next`: the held frame first, then the outcome.
    const deliver = () => {
      if (!waiter) return
      const w = waiter
      if (held) {
        const f = held
        held = undefined
        waiter = undefined
        pending = undefined
        w.resolve(f)
        if (!done) {
          req?.resume()
          parse()
        }
        return
      }
      if (outcome) {
        waiter = undefined
        pending = undefined
        if (outcome.error) w.reject(outcome.error)
        else w.resolve(null)
      }
    }

    // The first outcome wins. `now` (close, abort) drops a held frame too.
    function end(error: OvdError | null, now = false): void {
      if (now) held = undefined
      if (done) {
        // A close after a failure that no `next` saw yet: the caller asked to stop.
        if (now) outcome = { error: null }
        deliver()
        return
      }
      done = true
      outcome = { error }
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      chunks.length = 0
      buffered = 0
      if (error || now) session.destroy()
      else session.close()
      deliver()
    }

    // The first `n` buffered bytes, copied out, without consuming them.
    const peek = (n: number): Uint8Array => {
      const out = new Uint8Array(n)
      let at = 0
      for (const chunk of chunks) {
        if (at >= n) break
        const take = Math.min(n - at, chunk.length)
        out.set(chunk.subarray(0, take), at)
        at += take
      }
      return out
    }
    // The first `n` buffered bytes, copied out and dropped from the buffer.
    const take = (n: number): Uint8Array => {
      const out = new Uint8Array(n)
      let at = 0
      while (at < n) {
        const chunk = chunks[0]
        if (!chunk) break
        const part = Math.min(n - at, chunk.length)
        out.set(chunk.subarray(0, part), at)
        at += part
        if (part === chunk.length) chunks.shift()
        else chunks[0] = chunk.subarray(part)
      }
      buffered -= n
      return out
    }

    // Decodes buffered frames until one is held (the stream then pauses) or bytes run out.
    function parse(): void {
      while (!done && !held && buffered >= 5) {
        const head = peek(5)
        if (head[0] !== 0) {
          end(grpcError('Emulator gRPC sent a compressed screen frame'))
          return
        }
        const length = new DataView(head.buffer).getUint32(1)
        if (buffered < 5 + length) return
        take(5)
        let decoded: ScreenFrame
        try {
          decoded = decodeImageFrame(take(length))
        } catch {
          end(grpcError(`Could not read the emulator gRPC ${method} answer`))
          return
        }
        if (!firstFrame) {
          firstFrame = true
          clearTimeout(timer)
        }
        held = decoded
        if (waiter) deliver()
        else req?.pause()
      }
    }

    // Where a finished stream leaves its caller: ended (null) on a stop, else why it failed.
    const finished = () => {
      if (done) return
      if (!headers) {
        end(grpcError(`Emulator gRPC ${method} closed without an answer`))
        return
      }
      const trailersOnly = headers['grpc-status'] !== undefined
      const status = String(trailers['grpc-status'] ?? headers['grpc-status'] ?? '')
      if (status === UNAUTHENTICATED) {
        end(grpcError('Emulator gRPC rejected OVD’s token', { grpcStatus: status }))
      } else if (trailersOnly || (status !== '' && status !== '0' && status !== UNAVAILABLE)) {
        end(grpcError(`Emulator gRPC ${method} failed`, { grpcStatus: status }))
      } else end(null)
    }

    if (signal?.aborted) {
      end(null, true)
    } else {
      signal?.addEventListener('abort', onAbort, { once: true })
      session.on('error', (error: NodeJS.ErrnoException) => {
        // Once the stream answered, a session that drops (the emulator quit) is its end.
        if (headers) end(null)
        else {
          end(grpcError(`Couldn’t reach emulator gRPC on port ${opts.port}`, { cause: error.code }))
        }
      })
      // GOAWAY, then the stream's trailers: `finished` reads them; a session that closes
      // without them ended the stream all the same.
      session.on('close', () => finished())
      const stream = session.request({
        ':method': 'POST',
        ':path': `${SERVICE}/${method}`,
        'content-type': 'application/grpc',
        te: 'trailers',
        authorization: `Bearer ${opts.token}`
      })
      req = stream
      stream.on('response', (h: IncomingHttpHeaders) => {
        headers = h
        if (Number(h[':status']) !== 200) {
          end(grpcError(`Emulator gRPC ${method} answered HTTP ${String(h[':status'])}`))
        }
      })
      stream.on('trailers', (t: IncomingHttpHeaders) => (trailers = t))
      stream.on('data', (chunk: Buffer) => {
        if (done) return
        chunks.push(chunk)
        buffered += chunk.length
        parse()
      })
      stream.on('error', (error: NodeJS.ErrnoException) => {
        if (headers) finished()
        else end(grpcError(`Emulator gRPC ${method} failed`, { cause: error.code }))
      })
      stream.on('end', finished)
      stream.on('close', finished)
      stream.end(frame(encodeImageFormat(format)))
    }

    return {
      next() {
        if (pending) return pending
        pending = new Promise<ScreenFrame | null>((resolve, reject) => {
          waiter = { resolve, reject }
        })
        const p = pending
        deliver()
        return p
      },
      close: () => end(null, true)
    }
  }

  return {
    streamScreenshot: (format, streamOpts = {}) => streamScreenshot(format, streamOpts.signal),

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
