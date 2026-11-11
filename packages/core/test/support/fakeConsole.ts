import { Duplex } from 'node:stream'
import { fixture } from './fixtures.js'

export const CONSOLE_TOKEN = 'ovd-fake-console-token'

const recorded = (name: string) => fixture(`0.24/emulator-console/${name}`)

// Splits a reply in chunks, cut mid-line, as the real console sends it.
function chunks(text: string): string[] {
  const third = Math.max(1, Math.floor(text.length / 3))
  return [text.slice(0, third), text.slice(third, 2 * third), text.slice(2 * third)].filter(
    (c) => c !== ''
  )
}

export interface FakeConsoleOptions {
  // What the port sends on connect; the console greeting by default.
  greeting?: string | null
  // Fails the connection with this error code (`ECONNREFUSED`), as `net.connect` does.
  refuse?: string
  // Sends nothing at all after the greeting.
  silentAfterGreeting?: boolean
}

// An emulator console that answers only with the recordings (fixtures/0.24/emulator-console).
export function fakeConsole(opts: FakeConsoleOptions = {}) {
  const written: string[] = []
  const ports: number[] = []
  const sockets: Duplex[] = []
  const connect = (port: number): Duplex => {
    ports.push(port)
    let authed = false
    const socket: Duplex = new Duplex({
      read() {},
      write(chunk: Buffer, _enc, done) {
        const line = chunk.toString().replace(/\r?\n$/, '')
        written.push(line)
        if (!opts.silentAfterGreeting) {
          let reply: string
          if (line.startsWith('auth ')) {
            authed = line === `auth ${CONSOLE_TOKEN}`
            reply = recorded(authed ? 'auth-ok.txt' : 'auth-bad.txt')
          } else if (/^grpc \d+$/.test(line) && authed) {
            reply = recorded('grpc-enabled.txt').replaceAll('8554', line.slice(5))
          } else {
            reply = recorded('unknown-command.txt')
          }
          queueMicrotask(() => chunks(reply).forEach((c) => socket.push(c)))
        }
        done()
      }
    })
    sockets.push(socket)
    queueMicrotask(() => {
      if (opts.refuse) {
        const error = Object.assign(new Error(`connect ${opts.refuse}`), { code: opts.refuse })
        socket.destroy(error)
        return
      }
      const greeting = opts.greeting === undefined ? recorded('greeting.txt') : opts.greeting
      if (greeting !== null) chunks(greeting).forEach((c) => socket.push(c))
    })
    return socket
  }
  return { connect, written, ports, sockets }
}
