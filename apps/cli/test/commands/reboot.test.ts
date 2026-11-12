import type { RebootOptions, RebootResult } from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import { cli } from '../support/runCli.js'
import { fail, stubReboot } from '../support/sample.js'

const result: RebootResult = {
  target: { id: 'VirtualDevice', name: 'Vega Virtual Device' },
  seconds: 16,
  reconnected: false
}

// A core reboot that reports each step, as core does, then resolves.
function rebooting(steps: Parameters<NonNullable<RebootOptions['onProgress']>>[0][]) {
  return vi.fn(async (opts?: RebootOptions) => {
    for (const step of steps) opts?.onProgress?.(step, result.target)
    return result
  })
}

describe('ovd reboot', () => {
  test('--json prints the reboot; progress goes to stderr', async () => {
    const reboot = rebooting(['rebooting', 'waiting', 'settling', 'waiting', 'settling'])
    const { stdout, stderr, exitCode } = await cli(['reboot', '--json'], {
      ovd: stubReboot({ reboot })
    })
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ ok: true, reboot: result })
    expect(stderr).toBe(
      'Rebooting Vega Virtual Device…\n' +
        'Waiting for Vega Virtual Device to come back (up to 120 s)…\n'
    )
    expect(reboot).toHaveBeenCalledWith({
      timeoutMs: 120_000,
      signal: expect.any(AbortSignal),
      onProgress: expect.any(Function)
    })
  })

  test('the human line', async () => {
    const { stdout } = await cli(['reboot'], { ovd: stubReboot({ reboot: rebooting([]) }) })
    expect(stdout).toBe('Rebooted Vega Virtual Device · back online in 16 s\n')
  })

  test('--device and --timeout reach core; a Wi‑Fi reconnect is reported', async () => {
    const reboot = rebooting(['rebooting', 'waiting', 'reconnecting'])
    const { stderr } = await cli(['reboot', '--device', 'VirtualDevice', '--timeout', '30'], {
      ovd: stubReboot({ reboot })
    })
    expect(reboot).toHaveBeenCalledWith(
      expect.objectContaining({ device: 'VirtualDevice', timeoutMs: 30_000 })
    )
    expect(stderr).toContain('(up to 30 s)')
    expect(stderr).toContain('Reconnecting VirtualDevice over Wi‑Fi…\n')
  })

  test.each(['29', '601', '1.5', 'soon', '-60'])(
    '--timeout %s is a usage error before any SDK call',
    async (value) => {
      const { stdout, exitCode } = await cli(['reboot', '--json', `--timeout=${value}`])
      expect(exitCode).toBe(2)
      expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'INVALID_TIMEOUT' } })
    }
  )

  test.each([
    ['REBOOT_FAILED', 1],
    ['REBOOT_TIMEOUT', 1],
    ['SDK_NOT_FOUND', 3],
    ['NO_TARGET', 4],
    ['TARGET_OFFLINE', 4]
  ] as const)('%s exits %i', async (code, exit) => {
    const { stdout, exitCode } = await cli(['reboot', '--json'], {
      ovd: stubReboot({ reboot: fail(code) })
    })
    expect(exitCode).toBe(exit)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code } })
  })

  test('Ctrl+C cancels the wait: exit 1, the device may still be rebooting', async () => {
    let interrupt = () => undefined as void
    const reboot = vi.fn(
      (opts?: RebootOptions) =>
        new Promise<RebootResult>((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
          interrupt()
        })
    )
    const { stdout, exitCode } = await cli(['reboot', '--json'], {
      ovd: stubReboot({ reboot }),
      onInterrupt: (abort) => (interrupt = abort)
    })
    expect(exitCode).toBe(1)
    expect(JSON.parse(stdout)).toEqual({
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: 'Cancelled',
        hint: 'The device may still be rebooting'
      }
    })
  })
})
