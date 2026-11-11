import type { Duplex } from 'node:stream'
import {
  consoleReplyDone,
  isConsoleGreeting,
  parseConsoleReply,
  parseGrpcEnabled
} from '../adapters/parseEmulatorConsole.js'
import { OvdError } from '../errors/ovdError.js'

// Opens a TCP connection to the console on 127.0.0.1 (`net.connect` in production).
export type ConsoleConnect = (port: number) => Duplex

export interface EnableGrpcOptions {
  consolePort: number
  grpcPort: number
  // From `~/.emulator_console_auth_token`. Never logged and never put in an error.
  token: string
  connect: ConsoleConnect
  // For the whole exchange: greeting, auth and `grpc`.
  timeoutMs: number
  signal?: AbortSignal
}

// A failure worth another attempt: the console isn't up yet (refused, closed, no answer).
export function consoleError(message: string, hint: string, retryable: boolean): OvdError {
  return new OvdError('VVD_GRPC_FAILED', message, hint, { retryable })
}

export function isRetryable(error: OvdError): boolean {
  return error.details?.retryable === true
}

// Turns on the emulator gRPC endpoint through the console (ADR 0010): wait for the greeting,
// `auth <token>`, then `grpc <port>`. The token goes out only after a real console greeting,
// so another program on the port never sees it.
export function enableGrpc(opts: EnableGrpcOptions): Promise<{ port: number }> {
  const { consolePort, signal } = opts
  if (signal?.aborted) return Promise.reject(signal.reason as Error)
  const unreachable = (why: string) =>
    consoleError(
      `Couldn’t reach the emulator console on port ${consolePort} (${why})`,
      'Check that the Virtual Device is running, then run ovd vvd start again',
      true
    )

  return new Promise((resolve, reject) => {
    const socket = opts.connect(consolePort)
    let buffer = ''
    let settled = false
    let waiting: (() => void) | null = null

    const finish = (error: unknown, value?: { port: number }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      socket.destroy()
      if (value) resolve(value)
      else reject(error)
    }
    const onAbort = () => finish(signal?.reason)
    const timer = setTimeout(() => finish(unreachable('no answer')), opts.timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })

    socket.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString()
      waiting?.()
    })
    socket.on('error', (error: NodeJS.ErrnoException) => {
      finish(unreachable(error.code ?? 'connection error'))
    })
    socket.on('close', () => finish(unreachable('connection closed')))

    // The next complete reply; the buffer starts empty for the one after it.
    const reply = () =>
      new Promise<string>((done) => {
        const check = () => {
          if (!consoleReplyDone(buffer)) return
          const text = buffer
          buffer = ''
          waiting = null
          done(text)
        }
        waiting = check
        check()
      })
    const send = (line: string) => socket.write(`${line}\r\n`)

    const talk = async (): Promise<{ port: number }> => {
      const greeting = await reply()
      if (!isConsoleGreeting(greeting)) {
        throw consoleError(
          `Port ${consolePort} isn’t an emulator console`,
          'Set OVD_EMULATOR_CONSOLE_PORT to the Virtual Device’s console port',
          false
        )
      }
      send(`auth ${opts.token}`)
      const auth = parseConsoleReply(await reply())
      if (!auth.ok) {
        throw consoleError(
          'The emulator console rejected the token in ~/.emulator_console_auth_token',
          'Restart the Virtual Device with ovd vvd stop, then ovd vvd start',
          false
        )
      }
      send(`grpc ${opts.grpcPort}`)
      const text = await reply()
      const grpc = parseConsoleReply(text)
      if (!grpc.ok) {
        throw consoleError(
          `The emulator console didn’t turn gRPC on: ${grpc.error ?? 'KO'}`,
          'Restart the Virtual Device with ovd vvd stop, then ovd vvd start',
          false
        )
      }
      return parseGrpcEnabled(text)
    }

    talk().then(
      (value) => finish(undefined, value),
      (error: unknown) => finish(error)
    )
  })
}
