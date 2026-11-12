import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { createEmulator, type EmulatorDeps } from '../../src/index.js'
import { CONSOLE_TOKEN, fakeConsole, type FakeConsoleOptions } from '../support/fakeConsole.js'
import { fakeGrpc, type GrpcAnswer } from '../support/fakeGrpc.js'
import { fixture } from '../support/fixtures.js'

const recorded = fixture('0.24/emulator-discovery/virtual-device.ini')
const PID = 4242

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ovd-emulator-'))
})

const withDiscovery = (text = recorded) => writeFile(join(dir, `pid_${PID}.ini`), text)

function setup(
  opts: {
    console?: FakeConsoleOptions
    grpc?: GrpcAnswer
    env?: Record<string, string>
    token?: () => Promise<string>
    deps?: Partial<EmulatorDeps>
  } = {}
) {
  const console = fakeConsole(opts.console)
  const grpc = fakeGrpc(() => opts.grpc ?? 'get-vm-state-running.json')
  const tokens: string[] = []
  const sleeps: number[] = []
  const emulator = createEmulator({
    homedir: '/home/developer',
    env: opts.env ?? {},
    directories: [dir],
    connect: console.connect,
    http2Connect: grpc.connect,
    isAlive: (pid) => pid === PID,
    readToken: async (file) => {
      tokens.push(file)
      return opts.token ? opts.token() : `${CONSOLE_TOKEN}\n`
    },
    sleep: async (ms, signal) => {
      signal?.throwIfAborted()
      sleeps.push(ms)
    },
    ...opts.deps
  })
  return { emulator, console, grpc, tokens, sleeps }
}

describe('Emulator.enableGrpc', () => {
  test('reads the token at runtime, turns gRPC on and returns the discovered port', async () => {
    await withDiscovery()
    const { emulator, console, tokens } = setup()
    expect(emulator.grpcPort).toBe(8554)
    expect(await emulator.enableGrpc('emulator-5554')).toEqual({ port: 8554 })
    expect(tokens).toEqual(['/home/developer/.emulator_console_auth_token'])
    expect(console.ports).toEqual([5554])
    expect(console.written).toEqual([`auth ${CONSOLE_TOKEN}`, 'grpc 8554'])
  })

  test.each([
    ['emulator-5556', {}, 5556, 8554],
    ['VirtualDevice', {}, 5554, 8554],
    [
      'emulator-5554',
      { OVD_EMULATOR_CONSOLE_PORT: '40001', OVD_EMULATOR_GRPC_PORT: '40002' },
      40001,
      40002
    ],
    [
      'emulator-5554',
      { OVD_EMULATOR_CONSOLE_PORT: 'nope', OVD_EMULATOR_GRPC_PORT: '0' },
      5554,
      8554
    ]
  ])('ports for %s with %j', async (serial, env, consolePort, grpcPort) => {
    await withDiscovery(recorded.replace('port.serial=5554', `port.serial=${consolePort}`))
    const { emulator, console } = setup({ env })
    await emulator.enableGrpc(serial)
    expect(console.ports).toEqual([consolePort])
    expect(console.written.at(-1)).toBe(`grpc ${grpcPort}`)
  })

  test('a missing token file: VVD_GRPC_FAILED, nothing connects', async () => {
    const { emulator, console } = setup({
      token: () => Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    })
    await expect(emulator.enableGrpc('emulator-5554')).rejects.toMatchObject({
      code: 'VVD_GRPC_FAILED',
      message: '~/.emulator_console_auth_token is missing or unreadable',
      details: { retryable: false }
    })
    expect(console.ports).toEqual([])
  })

  test('an empty token file', async () => {
    const { emulator } = setup({ token: async () => '\n' })
    await expect(emulator.enableGrpc('emulator-5554')).rejects.toMatchObject({
      message: '~/.emulator_console_auth_token is empty'
    })
  })

  test('no discovery file after 2 s of polling', async () => {
    const { emulator, sleeps } = setup()
    await expect(emulator.enableGrpc('emulator-5554')).rejects.toMatchObject({
      code: 'VVD_GRPC_FAILED',
      message: 'gRPC is on, but OVD can’t find the emulator’s discovery file'
    })
    expect(sleeps).toEqual(Array(10).fill(200))
  })

  test('a failure that isn’t an OvdError is wrapped, without its text', async () => {
    const { emulator } = setup({
      deps: {
        connect: () => {
          throw new Error(`socket exploded near ${CONSOLE_TOKEN}`)
        }
      }
    })
    const error: unknown = await emulator.enableGrpc('emulator-5554').catch((e: unknown) => e)
    expect(error).toMatchObject({
      code: 'VVD_GRPC_FAILED',
      message: 'Couldn’t turn on emulator gRPC'
    })
    expect(JSON.stringify(error)).not.toContain(CONSOLE_TOKEN)
  })

  test('an abort propagates as an AbortError', async () => {
    const controller = new AbortController()
    controller.abort()
    const { emulator } = setup()
    await expect(
      emulator.enableGrpc('emulator-5554', { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('a refused console is a retryable failure', async () => {
    const { emulator } = setup({ console: { refuse: 'ECONNREFUSED' } })
    await expect(emulator.enableGrpc('emulator-5554')).rejects.toMatchObject({
      code: 'VVD_GRPC_FAILED',
      details: { retryable: true }
    })
  })
})

describe('Emulator.grpc', () => {
  test('on: getVmState answers with the discovery file’s token', async () => {
    await withDiscovery()
    const { emulator, grpc, console } = setup()
    expect(await emulator.grpc('emulator-5554')).toEqual({ status: 'on', port: 8554 })
    expect(grpc.requests[0]?.headers.authorization).toMatch(/^Bearer b3Zk/)
    expect(String(grpc.requests[0]?.headers[':path'])).toMatch(/\/getVmState$/)
    // Read-only: the console is never used.
    expect(console.ports).toEqual([])
  })

  test.each(['get-vm-state-unauthenticated.json', 'refused'] as const)(
    'off when gRPC answers %s',
    async (answer) => {
      await withDiscovery()
      const { emulator } = setup({ grpc: answer })
      expect(await emulator.grpc('emulator-5554')).toEqual({ status: 'off' })
    }
  )

  test('off without a discovery file, and nothing is called', async () => {
    const { emulator, grpc } = setup()
    expect(await emulator.grpc('emulator-5554')).toEqual({ status: 'off' })
    expect(grpc.requests).toEqual([])
  })
})

describe('Emulator.sendKeys', () => {
  const events = [
    { keyCode: 158, eventType: 'down' as const },
    { keyCode: 158, eventType: 'up' as const }
  ]

  test('sends over one session with the discovery file’s token and port', async () => {
    await withDiscovery()
    const { emulator, grpc, console } = setup({ grpc: 'send-key.json' })
    await emulator.sendKeys('emulator-5554', events)
    expect(grpc.requests.map((r) => r.authority)).toEqual([
      'http://127.0.0.1:8554',
      'http://127.0.0.1:8554'
    ])
    expect(grpc.requests[0]?.headers.authorization).toMatch(/^Bearer b3Zk/)
    expect(grpc.sessions).toHaveLength(1)
    // Send only: it never turns gRPC on.
    expect(console.ports).toEqual([])
  })

  test('without a discovery file: VVD_GRPC_FAILED with off, and nothing is sent', async () => {
    const { emulator, grpc, console } = setup()
    await expect(emulator.sendKeys('emulator-5554', events)).rejects.toMatchObject({
      code: 'VVD_GRPC_FAILED',
      details: { off: true }
    })
    expect(grpc.requests).toEqual([])
    expect(console.ports).toEqual([])
  })

  test('a rejected token is VVD_GRPC_FAILED, not off', async () => {
    await withDiscovery()
    const { emulator } = setup({ grpc: 'get-vm-state-unauthenticated.json' })
    const error: unknown = await emulator.sendKeys('emulator-5554', events).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'VVD_GRPC_FAILED' })
    expect((error as { details?: Record<string, unknown> }).details?.off).toBeUndefined()
  })
})
