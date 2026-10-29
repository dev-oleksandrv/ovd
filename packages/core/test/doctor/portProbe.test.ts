import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, test } from 'vitest'
import { portInUse } from '../../src/index.js'

const servers: Server[] = []

function listen(port = 0): Promise<number> {
  const server = createServer()
  servers.push(server)
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : port)
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(close))
})

describe('portInUse', () => {
  test('a port someone listens on is in use', async () => {
    const port = await listen()
    expect(await portInUse(port)).toBe(true)
  })

  test('a free port is free, and the probe releases it', async () => {
    const port = await listen()
    const held = servers.pop()
    if (held) await close(held)
    expect(await portInUse(port)).toBe(false)
    expect(await listen(port)).toBe(port)
  })
})
