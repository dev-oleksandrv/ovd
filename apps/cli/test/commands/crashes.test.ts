import {
  OvdError,
  type Crash,
  type CrashesList,
  type CrashPullOptions,
  type CrashPullResult,
  type CrashWatch,
  type CrashWatchOptions,
  type ErrorCode,
  type Ovd
} from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import { cli } from '../support/runCli.js'
import { fail } from '../support/sample.js'

const crash: Crash = {
  id: 105,
  package: 'com.example.player',
  kind: 'js',
  signal: 6,
  signalName: 'SIGABRT',
  pid: 7746,
  time: '2026-11-12T09:00:00.000Z',
  version: '0.1.0',
  build: '1',
  summary: 'Error: boom',
  new: false
}
const list: CrashesList = { device: 'Vega Virtual Device', crashes: [crash] }
const pulled: CrashPullResult = {
  crash,
  path: '/home/developer/ovd/crashes/com.example.player-1762938000-7746.acr',
  bytes: 301471
}

function stubCrashes(crashes: Partial<Ovd['crashes']>): Partial<Ovd> {
  const missing = (name: string) => () => Promise.reject(new Error(`unexpected ${name}`))
  return {
    crashes: {
      list: missing('list'),
      detail: missing('detail'),
      watch: () => {
        throw new Error('unexpected watch')
      },
      pull: missing('pull'),
      dir: () => '/home/developer/ovd/crashes',
      ...crashes
    }
  }
}

describe('ovd crashes', () => {
  test('--json prints the list document for the target', async () => {
    const listFn = vi.fn(async () => list)
    const { stdout, exitCode } = await cli(['crashes', '--json'], {
      ovd: stubCrashes({ list: listFn })
    })
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ ok: true, ...list })
    expect(listFn).toHaveBeenCalledWith(undefined)
  })

  test('--device reaches core', async () => {
    const listFn = vi.fn(async () => list)
    await cli(['crashes', '--device', 'VirtualDevice', '--json'], {
      ovd: stubCrashes({ list: listFn })
    })
    expect(listFn).toHaveBeenCalledWith('VirtualDevice')
  })

  test('human output escapes control characters of device text', async () => {
    const { stdout } = await cli(['crashes'], {
      ovd: stubCrashes({
        list: async () => ({
          device: 'Vega Virtual Device',
          crashes: [{ ...crash, summary: 'Error: \u001b[2Jboom\u202e' }]
        })
      })
    })
    expect(stdout).toContain('Error: \\x1b[2Jboom\\u{202e}')
    // eslint-disable-next-line no-control-regex -- the point of the test
    expect(stdout).not.toMatch(/[\u001b\u202e]/)
  })

  test('--json keeps the device text exact', async () => {
    const summary = 'Error: \u001b[2Jboom'
    const { stdout } = await cli(['crashes', '--json'], {
      ovd: stubCrashes({
        list: async () => ({ device: 'Vega Virtual Device', crashes: [{ ...crash, summary }] })
      })
    })
    expect(JSON.parse(stdout).crashes[0].summary).toBe(summary)
  })

  test.each<[ErrorCode, number]>([
    ['TARGET_OFFLINE', 4],
    ['NO_TARGET', 4],
    ['DEVICE_NOT_FOUND', 4],
    ['SDK_NOT_FOUND', 3],
    ['COMMAND_FAILED', 1]
  ])('%s exits %i with the error document', async (code, exit) => {
    const { stdout, exitCode } = await cli(['crashes', '--json'], {
      ovd: stubCrashes({ list: fail(code) })
    })
    expect(exitCode).toBe(exit)
    expect(JSON.parse(stdout)).toEqual({
      ok: false,
      error: { code, message: `failed: ${code}`, hint: `hint for ${code}` }
    })
  })
})

describe('ovd crashes --watch', () => {
  // Runs the command until the test presses Ctrl+C; `during` drives the watcher's callbacks.
  async function watching(
    args: string[],
    during: (opts: CrashWatchOptions) => void | Promise<void>
  ) {
    let interrupt = (): void => undefined
    let opts: CrashWatchOptions | undefined
    const stop = vi.fn()
    const run = cli(['crashes', '--watch', ...args], {
      ovd: stubCrashes({
        list: async () => list,
        watch: (o): CrashWatch => {
          opts = o
          return { stop }
        }
      }),
      onInterrupt: (abort) => (interrupt = abort)
    })
    await vi.waitFor(() => expect(opts).toBeDefined())
    await during(opts as CrashWatchOptions)
    interrupt()
    return { ...(await run), stop, opts: opts as CrashWatchOptions }
  }

  const device = { id: 'VirtualDevice', name: 'Vega Virtual Device' }

  test('--json: the list document, then one line per new report, then OVD lines; exit 0 on Ctrl+C', async () => {
    const next: Crash = { ...crash, id: 106, new: true }
    const { stdout, exitCode, stop } = await watching(
      ['--json', '--device', 'VirtualDevice'],
      (o) => {
        o.onNew(next, device)
        o.onAway?.(device)
        o.onBack?.(device)
      }
    )
    expect(exitCode).toBe(0)
    expect(stop).toHaveBeenCalledOnce()
    const lines = stdout
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(lines).toEqual([
      { ok: true, ...list },
      { ok: true, crash: next },
      { time: expect.any(String), ovd: { kind: 'disconnected' }, message: expect.any(String) },
      { time: expect.any(String), ovd: { kind: 'reconnected' }, message: expect.any(String) }
    ])
  })

  test('the device and the polling reach core', async () => {
    const { opts } = await watching(['--device', 'VirtualDevice'], () => undefined)
    expect(opts.device).toBe('VirtualDevice')
  })

  test('human output: the list, the new report and OVD lines; errors go to stderr', async () => {
    const { stdout, stderr, exitCode } = await watching([], (o) => {
      o.onNew({ ...crash, id: 106, new: true }, device)
      o.onAway?.(device)
      o.onBack?.(device)
      o.onError?.(new OvdError('COMMAND_FAILED', 'Could not read the vault', 'Retry'))
    })
    expect(exitCode).toBe(0)
    expect(stdout).toMatch(/^105 {2}js {2}com\.example\.player/)
    expect(stdout).toMatch(/\n106 {2}js .*NEW/)
    expect(stdout).toMatch(/\d\d:\d\d:\d\d\.\d{3} OVD Vega Virtual Device went away/)
    expect(stdout).toMatch(/OVD Vega Virtual Device is back/)
    expect(stderr).toContain('Error: Could not read the vault\nRetry\n')
    expect(exitCode).toBe(0)
  })

  test('a failing first list exits with its code and starts no watch', async () => {
    const watch = vi.fn()
    const { stdout, exitCode } = await cli(['crashes', '--watch', '--json'], {
      ovd: stubCrashes({ list: fail('TARGET_OFFLINE'), watch })
    })
    expect(exitCode).toBe(4)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'TARGET_OFFLINE' } })
    expect(watch).not.toHaveBeenCalled()
  })
})

describe('ovd crash pull', () => {
  test('--json prints the crash, the path and the bytes', async () => {
    const pull = vi.fn(async (_opts: CrashPullOptions) => pulled)
    const { stdout, exitCode } = await cli(['crash', 'pull', '105', '--json'], {
      ovd: stubCrashes({ pull })
    })
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ ok: true, ...pulled })
    expect(pull).toHaveBeenCalledWith({ id: '105', force: false, signal: expect.any(AbortSignal) })
  })

  test('--device, --out and --force reach core', async () => {
    const pull = vi.fn(async (_opts: CrashPullOptions) => pulled)
    await cli(['crash', 'pull', '105', '--device', 'VirtualDevice', '--out', 'c.acr', '--force'], {
      ovd: stubCrashes({ pull })
    })
    expect(pull).toHaveBeenCalledWith({
      id: '105',
      device: 'VirtualDevice',
      out: 'c.acr',
      force: true,
      signal: expect.any(AbortSignal)
    })
  })

  test('human output', async () => {
    const { stdout } = await cli(['crash', 'pull', '105'], {
      ovd: stubCrashes({ pull: async () => pulled })
    })
    expect(stdout).toBe(`Saved ${pulled.path} (301471 bytes): crash 105 of com.example.player\n`)
  })

  test.each<[ErrorCode, number]>([
    ['INVALID_CRASH_ID', 2],
    ['CRASH_NOT_FOUND', 1],
    ['CRASH_ACCESS_DENIED', 1],
    ['CRASH_PULL_FAILED', 1],
    ['EXPORT_FILE_EXISTS', 2],
    ['INVALID_PATH', 2],
    ['TARGET_OFFLINE', 4],
    ['NO_TARGET', 4],
    ['SDK_NOT_FOUND', 3]
  ])('%s exits %i with the error document', async (code, exit) => {
    const { stdout, exitCode } = await cli(['crash', 'pull', 'x', '--json'], {
      ovd: stubCrashes({ pull: fail(code) })
    })
    expect(exitCode).toBe(exit)
    expect(JSON.parse(stdout)).toEqual({
      ok: false,
      error: { code, message: `failed: ${code}`, hint: `hint for ${code}` }
    })
  })

  test('Ctrl+C aborts core and reports Cancelled', async () => {
    let interrupt = (): void => undefined
    const pull = vi.fn(
      (opts: CrashPullOptions) =>
        new Promise<CrashPullResult>((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          )
        })
    )
    const run = cli(['crash', 'pull', '105', '--json'], {
      ovd: stubCrashes({ pull }),
      onInterrupt: (abort) => (interrupt = abort)
    })
    await vi.waitFor(() => expect(pull).toHaveBeenCalled())
    interrupt()
    const { stdout, exitCode } = await run
    expect(exitCode).toBe(1)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { message: 'Cancelled' } })
  })
})
