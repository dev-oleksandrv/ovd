import {
  OvdError,
  type ErrorCode,
  type LogEntry,
  type LogSession,
  type LogSessionEnd,
  type LogStartOptions,
  type Ovd,
  type RestartResult,
  type RunOptions,
  type RunOutcome
} from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import { cli } from '../support/runCli.js'

const target = { id: 'VirtualDevice', name: 'Vega Virtual Device', architecture: 'aarch64' }
const pkg = {
  path: '/home/dev/dev/player/build/aarch64-debug/player_aarch64.vpkg',
  displayPath: '~/dev/player/build/aarch64-debug/player_aarch64.vpkg',
  file: 'player_aarch64.vpkg',
  id: 'com.example.player',
  title: 'Sample Player',
  version: '1.4.2',
  buildNumber: 142,
  architecture: 'aarch64' as const,
  buildType: 'debug' as const,
  folder: 'build/aarch64-debug/'
}
const app = {
  packageId: 'com.example.player',
  title: 'Sample Player',
  componentId: 'com.example.player.main'
}
const verified: RestartResult = {
  target: { id: target.id, name: target.name },
  app,
  wasRunning: false,
  launched: true,
  verified: true,
  pid: 3571
}
const crashed: RestartResult = {
  target: { id: target.id, name: target.name },
  app,
  wasRunning: false,
  launched: true,
  verified: false,
  reason: 'crashed',
  crash: {
    pid: 3200,
    time: '2026-11-08T01:51:44.657Z',
    signal: 'SIGABRT',
    language: 'JavaScript',
    message: 'Error: player: deliberate crash right after launch',
    stack: ['at anonymous (index.bundle:652:20)'],
    logs: ['Nov 08 01:53:24.202327 lcm_service[1035]: Launched in pid 3200']
  }
}
const outcome = (launch: RestartResult): RunOutcome => ({
  target,
  package: pkg,
  forced: false,
  launch
})

// An entry as core parses it from fixtures/0.24/loggingctl-log/virtual-device-restart-before.txt.
const line = (seq: number): LogEntry => ({
  seq,
  time: '2026-11-09T21:42:32.676Z',
  deviceTime: 'Nov 09 21:42:32.676165',
  level: 'I',
  priority: 'info',
  facility: 'daemon',
  process: 'systemd-journald',
  pid: 321,
  tid: null,
  tag: 'systemd-journald',
  message: `Journal header limits reached or header out-of-date, rotating. ${seq}`,
  parsed: true
})

interface Stub {
  ovd: Partial<Ovd>
  run: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  // The session's `onEntries`, once it started.
  emit: (entries: LogEntry[]) => void
  finish: (end: LogSessionEnd) => void
}

// A core whose `run.run` emits its steps, starts the log through `followLogs` (whose session
// prints `before` right away), then returns `result` or throws it; `hold` makes the run wait
// for the abort instead (Ctrl+C during the steps).
function stub(
  result: RunOutcome | OvdError,
  opts: { before?: LogEntry[]; hold?: boolean; followFirst?: boolean } = {}
): Stub {
  let onEntries: LogStartOptions['onEntries']
  let finish: (end: LogSessionEnd) => void = () => undefined
  const stop = vi.fn(async () => finish({ reason: 'stopped' }))
  const start = vi.fn(async (start: LogStartOptions = {}) => {
    onEntries = start.onEntries
    const done = new Promise<LogSessionEnd>((resolve) => {
      finish = resolve
      start.signal?.addEventListener('abort', () => resolve({ reason: 'stopped' }))
    })
    if (opts.before) start.onEntries?.(opts.before, { lines: 0, errors: 0, shown: 0 }, [])
    const session: LogSession = {
      target: { id: target.id, name: target.name },
      command: 'vega exec vda -s emulator-5554 shell loggingctl log -f -o short_concise',
      startedAt: '2026-11-09T21:42:32.000Z',
      done,
      setFilter: () => undefined,
      entries: () => [],
      counts: () => ({ lines: 0, errors: 0, shown: 0 }),
      apps: () => [],
      clear: () => undefined,
      state: () => 'following',
      setRestartAfterInstall: () => undefined,
      stop
    }
    return session
  })
  const run = vi.fn(async (_ref: string | undefined, run: RunOptions) => {
    if (result instanceof OvdError && opts.followFirst !== true) throw result
    run.onStep?.({ step: 'build', package: pkg, target })
    run.onStep?.({ step: 'install', package: pkg, target })
    run.onStep?.({ step: 'logs' })
    await run.followLogs(target, pkg.id)
    if (opts.hold) {
      await new Promise<void>((resolve) =>
        run.signal?.addEventListener('abort', () => resolve(), { once: true })
      )
      const error = new Error('The operation was aborted')
      error.name = 'AbortError'
      throw error
    }
    if (result instanceof OvdError) throw result
    run.onStep?.({ step: 'launch' })
    run.onStep?.({ step: 'verify' })
    return result
  })
  const ovd = {
    run: { run: run as unknown as Ovd['run']['run'] },
    logs: { start: start as unknown as Ovd['logs']['start'] }
  } as Partial<Ovd>
  return {
    ovd,
    run,
    start,
    stop,
    emit: (entries) => onEntries?.(entries, { lines: 0, errors: 0, shown: 0 }, []),
    finish: (end) => finish(end)
  }
}

const jsonLines = (stdout: string) =>
  stdout
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>)

describe('ovd run', () => {
  test('--json: the run first, then the held and the later log lines; Ctrl+C exits 0', async () => {
    const s = stub(outcome(verified), { before: [line(0), line(1)] })
    let interrupt = (): void => undefined
    const running = cli(['run', '--json', '--device', 'VirtualDevice'], {
      ovd: s.ovd,
      onInterrupt: (abort) => (interrupt = abort)
    })
    await vi.waitFor(() => expect(s.run).toHaveBeenCalled())
    await new Promise((resolve) => setImmediate(resolve))
    s.emit([line(2)])
    interrupt()
    const { stdout, stderr, exitCode } = await running

    const lines = jsonLines(stdout)
    expect(lines[0]).toEqual({ ok: true, run: outcome(verified) })
    expect(lines.slice(1).map((l) => l.message)).toEqual([0, 1, 2].map((n) => line(n).message))
    expect(exitCode).toBe(0)
    expect(s.run.mock.calls[0]?.[1]).toMatchObject({ device: 'VirtualDevice' })
    expect(s.start.mock.calls[0]?.[0]).toMatchObject({ device: 'VirtualDevice', capacity: 0 })
    expect(stderr).toContain('Found build build/aarch64-debug/player_aarch64.vpkg (debug)')
    expect(stderr).toContain('Following the log of Vega Virtual Device (Ctrl+C to stop)…')
  })

  test('--force is passed to core', async () => {
    const s = stub(new OvdError('NO_PACKAGE', 'No package given', 'hint'))
    await cli(['run', 'player.vpkg', '--force', '--json'], { ovd: s.ovd })
    expect(s.run.mock.calls[0]?.[0]).toBe('player.vpkg')
    expect(s.run.mock.calls[0]?.[1]).toMatchObject({ force: true })
  })

  test('a crash on launch: exit 7 with the run, no log lines, the session stopped', async () => {
    const s = stub(outcome(crashed), { before: [line(0)] })

    const { stdout, exitCode } = await cli(['run', '--json'], { ovd: s.ovd })

    const lines = jsonLines(stdout)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      ok: false,
      error: { code: 'LAUNCH_NOT_VERIFIED' },
      run: { launch: { verified: false, reason: 'crashed', crash: { pid: 3200 } } }
    })
    expect(exitCode).toBe(7)
    expect(s.stop).toHaveBeenCalled()
  })

  test('a crash on launch, human: the cause on stderr, nothing on stdout', async () => {
    const s = stub(outcome(crashed))
    const { stdout, stderr, exitCode } = await cli(['run'], { ovd: s.ovd })
    expect(stdout).toBe('')
    expect(stderr).toContain('Cause: SIGABRT · Error: player: deliberate crash right after launch')
    expect(exitCode).toBe(7)
  })

  test.each<[ErrorCode, number]>([
    ['ARCH_MISMATCH', 6],
    ['TARGET_OFFLINE', 4],
    ['NO_TARGET', 4],
    ['NO_PACKAGE', 2]
  ])('%s exits %i with one error line and no session', async (code, exit) => {
    const s = stub(new OvdError(code, `failed: ${code}`, 'hint'))

    const { stdout, exitCode } = await cli(['run', '--json'], { ovd: s.ovd })

    expect(jsonLines(stdout)).toEqual([
      { ok: false, error: { code, message: `failed: ${code}`, hint: 'hint' } }
    ])
    expect(exitCode).toBe(exit)
    expect(s.start).not.toHaveBeenCalled()
  })

  test('a failure after the session started stops it and drops its lines', async () => {
    const s = stub(new OvdError('APP_NOT_INSTALLED', 'failed', 'hint'), {
      before: [line(0)],
      followFirst: true
    })

    const { stdout, exitCode } = await cli(['run', '--json'], { ovd: s.ovd })

    expect(jsonLines(stdout)).toHaveLength(1)
    expect(exitCode).toBe(1)
    expect(s.stop).toHaveBeenCalled()
  })

  test('Ctrl+C during the steps: exit 0, nothing on stdout, the session stopped', async () => {
    const s = stub(outcome(verified), { before: [line(0)], hold: true })
    let interrupt = (): void => undefined
    const running = cli(['run', '--json'], {
      ovd: s.ovd,
      onInterrupt: (abort) => (interrupt = abort)
    })
    await vi.waitFor(() => expect(s.start).toHaveBeenCalled())
    await new Promise((resolve) => setImmediate(resolve))
    interrupt()
    const { stdout, exitCode } = await running

    expect(stdout).toBe('')
    expect(exitCode).toBe(0)
    expect(s.stop).toHaveBeenCalled()
  })

  test('a stream that gives up: exit 1, LOG_STREAM_ENDED as the last line', async () => {
    const s = stub(outcome(verified))
    const running = cli(['run', '--json'], { ovd: s.ovd })
    await vi.waitFor(() => expect(s.run).toHaveBeenCalled())
    await new Promise((resolve) => setImmediate(resolve))
    s.finish({
      reason: 'ended',
      error: new OvdError('LOG_STREAM_ENDED', 'Vega Virtual Device’s log stream ended', 'hint')
    })
    const { stdout, exitCode } = await running

    const lines = jsonLines(stdout)
    expect(lines[0]).toMatchObject({ ok: true })
    expect(lines.at(-1)).toMatchObject({ ok: false, error: { code: 'LOG_STREAM_ENDED' } })
    expect(exitCode).toBe(1)
  })

  test('human: the install and the verified launch on stdout, progress on stderr', async () => {
    const s = stub(outcome(verified))
    const running = cli(['run'], { ovd: s.ovd })
    await vi.waitFor(() => expect(s.run).toHaveBeenCalled())
    await new Promise((resolve) => setImmediate(resolve))
    s.finish({ reason: 'stopped' })
    const { stdout, stderr, exitCode } = await running

    expect(stdout).toBe(
      'Installed player_aarch64.vpkg (com.example.player 1.4.2) on Vega Virtual Device · aarch64\n' +
        'Launched com.example.player.main on Vega Virtual Device · verified, pid 3571\n'
    )
    expect(stderr.split('\n')).toEqual([
      'Found build build/aarch64-debug/player_aarch64.vpkg (debug)',
      'Installing on Vega Virtual Device…',
      'Starting the log session…',
      'Launching…',
      'Verifying launch…',
      'Following the log of Vega Virtual Device (Ctrl+C to stop)…',
      ''
    ])
    expect(exitCode).toBe(0)
  })
})
