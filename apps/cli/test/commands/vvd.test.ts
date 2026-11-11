import type { VvdStartResult, VvdState } from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import { cli } from '../support/runCli.js'
import { fail, stubVvd, vvd } from '../support/sample.js'

const online: VvdState = {
  running: true,
  status: 'online',
  device: {
    ...vvd,
    vdaSerial: 'emulator-5554',
    status: 'online',
    info: {
      os: 'OS 1.2',
      build: 'TV Ship/102282480',
      architecture: 'aarch64',
      profile: 'tv',
      product: 'vvrp-tv-arm64',
      simulated: true,
      developerMode: true,
      raw: { architecture: 'aarch64' }
    }
  }
}
const stopped: VvdState = { running: false, status: 'stopped', device: vvd }
const started: VvdStartResult = { ...online, grpc: { status: 'on', port: 8554 } }
const grpcFailed: VvdStartResult = {
  ...online,
  grpc: {
    status: 'failed',
    error: {
      code: 'VVD_GRPC_FAILED',
      message: '~/.emulator_console_auth_token is missing or unreadable',
      hint: 'Restart the Virtual Device with ovd vvd stop, then ovd vvd start'
    }
  }
}

describe('ovd vvd status', () => {
  test.each([online, stopped])('--json prints the state ($status)', async (state) => {
    const { stdout, exitCode } = await cli(['vvd', 'status', '--json'], {
      ovd: stubVvd({ status: async () => state })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, vvd: state })
    expect(exitCode).toBe(0)
  })

  test('human output', async () => {
    const run = (state: VvdState) =>
      cli(['vvd', 'status'], { ovd: stubVvd({ status: async () => state }) })
    expect((await run(online)).stdout).toBe('Virtual Device: online (aarch64)\n')
    expect((await run(stopped)).stdout).toBe('Virtual Device: stopped\n')
  })

  test('no Virtual Device in the SDK exits 4', async () => {
    const { stdout, exitCode } = await cli(['vvd', 'status', '--json'], {
      ovd: stubVvd({ status: fail('VVD_NOT_INSTALLED') })
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'VVD_NOT_INSTALLED' } })
    expect(exitCode).toBe(4)
  })
})

describe('ovd vvd start', () => {
  test('--json prints the started device; progress goes to stderr', async () => {
    const start = vi.fn(async () => started)
    const { stdout, stderr, exitCode } = await cli(['vvd', 'start', '--json'], {
      ovd: stubVvd({ start })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, vvd: started })
    expect(stderr).toBe('Starting the Virtual Device…\n')
    expect(exitCode).toBe(0)
    expect(start).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) })
  })

  test('human output names the gRPC port', async () => {
    const { stdout, stderr } = await cli(['vvd', 'start'], {
      ovd: stubVvd({ start: async () => started })
    })
    expect(stdout).toBe(
      'Virtual Device started (VirtualDevice · aarch64)\nEmulator gRPC on · :8554\n'
    )
    expect(stderr).toBe('Starting the Virtual Device…\n')
  })

  test('gRPC failed: the start still succeeds, the warning and hint go to stderr', async () => {
    const { stdout, stderr, exitCode } = await cli(['vvd', 'start'], {
      ovd: stubVvd({ start: async () => grpcFailed })
    })
    expect(stdout).toBe('Virtual Device started (VirtualDevice · aarch64)\n')
    expect(stderr).toBe(
      'Starting the Virtual Device…\n' +
        '! Emulator gRPC couldn’t be turned on: ~/.emulator_console_auth_token is missing or unreadable\n' +
        '  → Restart the Virtual Device with ovd vvd stop, then ovd vvd start\n'
    )
    expect(exitCode).toBe(0)
  })

  test('gRPC failed with --json: only the document says so, exit 0', async () => {
    const { stdout, stderr, exitCode } = await cli(['vvd', 'start', '--json'], {
      ovd: stubVvd({ start: async () => grpcFailed })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, vvd: grpcFailed })
    expect(stderr).toBe('Starting the Virtual Device…\n')
    expect(exitCode).toBe(0)
  })

  test('a failed start exits 1', async () => {
    const { stdout, exitCode } = await cli(['vvd', 'start', '--json'], {
      ovd: stubVvd({ start: fail('VVD_START_FAILED') })
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'VVD_START_FAILED' } })
    expect(exitCode).toBe(1)
  })

  test('Ctrl+C aborts the start', async () => {
    let interrupt: (() => void) | undefined
    const start = ({ signal }: { signal?: AbortSignal } = {}) =>
      new Promise<VvdStartResult>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          const error = new Error('The operation was aborted')
          error.name = 'AbortError'
          reject(error)
        })
        interrupt?.()
      })
    const { stdout, exitCode } = await cli(['vvd', 'start', '--json'], {
      ovd: stubVvd({ start }),
      onInterrupt: (abort) => (interrupt = abort)
    })
    expect(JSON.parse(stdout)).toMatchObject({
      ok: false,
      error: { code: 'COMMAND_FAILED', message: 'Cancelled' }
    })
    expect(exitCode).toBe(1)
  })
})

describe('ovd vvd stop', () => {
  test('--json prints the stopped state', async () => {
    const { stdout, exitCode } = await cli(['vvd', 'stop', '--json'], {
      ovd: stubVvd({ stop: async () => stopped })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, vvd: stopped })
    expect(exitCode).toBe(0)
  })

  test('a failed stop exits 1', async () => {
    const { stdout, exitCode } = await cli(['vvd', 'stop', '--json'], {
      ovd: stubVvd({ stop: fail('VVD_STOP_FAILED') })
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'VVD_STOP_FAILED' } })
    expect(exitCode).toBe(1)
  })
})

describe('ovd vvd devmode enable', () => {
  test('--json', async () => {
    const { stdout, exitCode } = await cli(['vvd', 'devmode', 'enable', '--json'], {
      ovd: stubVvd({ enableDeveloperMode: async () => ({ developerMode: true }) })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, vvd: { developerMode: true } })
    expect(exitCode).toBe(0)
  })

  test('human output', async () => {
    const { stdout } = await cli(['vvd', 'devmode', 'enable'], {
      ovd: stubVvd({ enableDeveloperMode: async () => ({ developerMode: true }) })
    })
    expect(stdout).toBe('Developer Mode on\n')
  })

  test.each([
    ['TARGET_OFFLINE', 4],
    ['VVD_DEVMODE_FAILED', 1]
  ] as const)('%s exits %i', async (code, exit) => {
    const { stdout, exitCode } = await cli(['vvd', 'devmode', 'enable', '--json'], {
      ovd: stubVvd({ enableDeveloperMode: fail(code) })
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code } })
    expect(exitCode).toBe(exit)
  })
})
