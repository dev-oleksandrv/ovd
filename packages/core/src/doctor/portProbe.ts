import { connect } from 'node:net'

const CONNECT_TIMEOUT_MS = 500

// Metro listens on the host, so a port is in use when something accepts a connection on it.
// Binding a test socket instead is wrong on macOS: a 127.0.0.1 bind succeeds next to a
// listener on 0.0.0.0 or ::, so a running Metro would look free.
export async function portInUse(port: number): Promise<boolean> {
  const answers = await Promise.all(['127.0.0.1', '::1'].map((host) => accepts(host, port)))
  return answers.some(Boolean)
}

function accepts(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    const done = (open: boolean) => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => done(false))
    socket.once('connect', () => done(true))
    // Refused, or no IPv6 on this host: nothing is listening there.
    socket.once('error', () => done(false))
  })
}
