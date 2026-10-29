import { createServer } from 'node:net'

// Metro listens on the host, so "in use" is decided by trying to bind the port ourselves.
// Any listen error counts as in use: the port isn't available to Metro either way.
export function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(true))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(false))
    })
  })
}
