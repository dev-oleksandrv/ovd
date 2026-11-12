// The Virtual Device's emulator endpoints, in the test process: a console (TCP) and gRPC
// (h2c), one pair per sandbox on ports of their own, so a real Virtual Device on this host is
// never touched. Both answer only with the recordings in fixtures/0.24/emulator-console and
// emulator-grpc. gRPC is on exactly while the sandbox's discovery file exists: the console
// writes it on `grpc <port>`, the fake `vega virtual-device start` and `stop` delete it.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttp2Server, type Http2Session } from 'node:http2'
import { createServer, type Socket } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoveryDir, readWorld } from './world.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/0.24')
const fixture = (path: string) => readFileSync(join(FIXTURES, path), 'utf8')

// The console token the sandbox writes to `~/.emulator_console_auth_token`.
export const FAKE_CONSOLE_TOKEN = 'ovd-fake-console-token'
const DISCOVERY = fixture('emulator-discovery/virtual-device.ini')
// The recorded (fake) `grpc.token`: the Bearer token gRPC calls must carry.
const GRPC_TOKEN = /^grpc\.token=(.*)$/m.exec(DISCOVERY)?.[1] ?? ''

export type GrpcCall =
  | { method: 'getVmState' }
  | { method: 'getScreenshot' }
  | { method: 'sendKey'; codeType: number; eventType: number; keyCode: number }

interface Recorded {
  headers: Record<string, string | number>
  trailers: Record<string, string>
  body: string
}

export interface FakeEmulator {
  consolePort: number
  grpcPort: number
  // The gRPC calls made with the right token: method and decoded key fields, never headers.
  grpcCalls(): GrpcCall[]
  // Console commands and gRPC methods with no recording.
  unhandled(): string[]
  close(): void
}

// The fields of a protobuf message made of varints (KeyboardEvent).
function varintFields(message: Buffer): Record<number, number> {
  const fields: Record<number, number> = {}
  let at = 0
  const read = () => {
    let value = 0
    let scale = 1
    for (;;) {
      const byte = message[at++]
      if (byte === undefined) throw new Error('fake emulator: truncated varint')
      value += (byte & 0x7f) * scale
      if ((byte & 0x80) === 0) return value
      scale *= 128
    }
  }
  while (at < message.length) {
    const tag = read()
    fields[tag >> 3] = read()
  }
  return fields
}

export function startFakeEmulator(sdkDir: string): FakeEmulator {
  const calls: GrpcCall[] = []
  const unhandled: string[] = []
  const sockets = new Set<Socket>()
  const sessions = new Set<Http2Session>()
  const dir = discoveryDir(sdkDir)
  const discoveryFile = join(dir, `pid_${process.pid}.ini`)
  let consolePort = 0

  const consoleServer = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => undefined)
    // Nothing listens while the Virtual Device is stopped.
    if (!readWorld(sdkDir).vvd.running) {
      socket.destroy()
      return
    }
    socket.write(fixture('emulator-console/greeting.txt'))
    let authed = false
    let buffer = ''
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.replace(/\r$/, '')
        if (line.startsWith('auth ')) {
          authed = line === `auth ${FAKE_CONSOLE_TOKEN}`
          socket.write(fixture(`emulator-console/${authed ? 'auth-ok' : 'auth-bad'}.txt`))
        } else if (!authed) {
          socket.write(fixture('emulator-console/unknown-command.txt'))
        } else if (/^grpc \d+$/.test(line)) {
          const port = line.slice('grpc '.length)
          mkdirSync(dir, { recursive: true })
          writeFileSync(
            discoveryFile,
            DISCOVERY.replace(/^port\.serial=.*$/m, `port.serial=${consolePort}`).replace(
              /^grpc\.port=.*$/m,
              `grpc.port=${port}`
            )
          )
          // The console echoes the port it was asked for.
          socket.write(fixture('emulator-console/grpc-enabled.txt').replaceAll('8554', port))
        } else {
          unhandled.push(`console: ${line}`)
          socket.destroy()
        }
      }
    })
  })
  consoleServer.listen(0)
  consolePort = (consoleServer.address() as { port: number }).port

  const grpc = createHttp2Server()
  grpc.on('session', (session) => {
    sessions.add(session)
    session.on('close', () => sessions.delete(session))
    session.on('error', () => undefined)
    // Before `grpc <port>`, or after a restart, the endpoint is off.
    if (!readWorld(sdkDir).vvd.running || !existsSync(discoveryFile)) session.destroy()
  })
  grpc.on('stream', (stream, headers) => {
    stream.on('error', () => undefined)
    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('end', () => {
      const answer = (name: string) => {
        const recorded = JSON.parse(fixture(`emulator-grpc/${name}`)) as Recorded
        const trailers = Object.keys(recorded.trailers).length > 0
        stream.respond(recorded.headers, trailers ? { waitForTrailers: true } : { endStream: true })
        if (!trailers) return
        stream.on('wantTrailers', () => stream.sendTrailers(recorded.trailers))
        stream.end(Buffer.from(recorded.body, 'hex'))
      }
      if (headers.authorization !== `Bearer ${GRPC_TOKEN}`) {
        answer('get-vm-state-unauthenticated.json')
        return
      }
      const method = String(headers[':path']).replace(
        /^\/android\.emulation\.control\.EmulatorController\//,
        ''
      )
      const body = Buffer.concat(chunks)
      if (method === 'getVmState') {
        calls.push({ method })
        answer('get-vm-state-running.json')
      } else if (method === 'getScreenshot') {
        calls.push({ method })
        answer('get-screenshot.json')
      } else if (method === 'sendKey') {
        const fields = varintFields(body.subarray(5))
        calls.push({
          method,
          codeType: fields[1] ?? 0,
          eventType: fields[2] ?? 0,
          keyCode: fields[3] ?? 0
        })
        answer('send-key.json')
      } else {
        unhandled.push(`grpc: ${String(headers[':path'])}`)
        stream.close()
      }
    })
  })
  grpc.listen(0)
  const grpcPort = (grpc.address() as { port: number }).port

  return {
    consolePort,
    grpcPort,
    grpcCalls: () => [...calls],
    unhandled: () => [...unhandled],
    close() {
      for (const socket of sockets) socket.destroy()
      for (const session of sessions) session.destroy()
      consoleServer.close()
      grpc.close()
      rmSync(discoveryFile, { force: true })
    }
  }
}
