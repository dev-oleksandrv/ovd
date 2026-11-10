import {
  OvdError,
  type BuildChange,
  type LogEntry,
  type LogSession,
  type LogSessionEnd,
  type LogStartOptions,
  type Ovd,
  type PackageBuild,
  type RestartResult,
  type RunOptions,
  type RunOutcome,
  type WatchOptions
} from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import { cli } from '../support/runCli.js'

const FOLDER = '/home/dev/dev/player'
const target = { id: 'VirtualDevice', name: 'Vega Virtual Device', architecture: 'aarch64' }
const build: PackageBuild = {
  path: `${FOLDER}/build/aarch64-debug/player_aarch64.vpkg`,
  displayPath: '~/dev/player/build/aarch64-debug/player_aarch64.vpkg',
  file: 'player_aarch64.vpkg',
  folder: 'build/aarch64-debug/',
  size: 1_000,
  modifiedAt: '2026-11-10T09:05:00.000Z',
  folderArch: 'aarch64',
  folderBuildType: 'debug'
}
const armv7: PackageBuild = {
  ...build,
  path: `${FOLDER}/build/armv7-release/player_armv7.vpkg`,
  displayPath: '~/dev/player/build/armv7-release/player_armv7.vpkg',
  file: 'player_armv7.vpkg',
  folder: 'build/armv7-release/',
  folderArch: 'armv7',
  folderBuildType: 'release'
}
const pkg = {
  path: build.path,
  displayPath: build.displayPath,
  file: build.file,
  id: 'com.example.player',
  title: 'Sample Player',
  version: '1.4.2',
  buildNumber: 142,
  architecture: 'aarch64' as const,
  buildType: 'debug' as const,
  folder: 'build/aarch64-debug/'
}
const verified: RestartResult = {
  target: { id: target.id, name: target.name },
  app: { packageId: pkg.id, title: pkg.title, componentId: 'com.example.player.main' },
  wasRunning: false,
  launched: true,
  verified: true,
  pid: 3571
}
const outcome: RunOutcome = { target, package: pkg, forced: false, launch: verified }
const change = (over: Partial<BuildChange> = {}): BuildChange => ({
  folder: { path: FOLDER, displayPath: '~/dev/player' },
  changed: [build],
  build,
  target,
  ...over
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

type RunImpl = (ref: string | undefined, opts: RunOptions) => Promise<RunOutcome>

// A run that goes through its steps like core: the install, then the log step, then the launch.
const runs =
  (result: RunOutcome | OvdError = outcome, opts: { failBeforeLogs?: boolean } = {}): RunImpl =>
  async (_ref, run) => {
    if (result instanceof OvdError && opts.failBeforeLogs) throw result
    run.onStep?.({ step: 'build', package: pkg, target })
    run.onStep?.({ step: 'install', package: pkg, target })
    run.onStep?.({ step: 'logs' })
    await run.followLogs(target, pkg.id)
    if (result instanceof OvdError) throw result
    run.onStep?.({ step: 'launch' })
    return result
  }

// A core with a project folder to watch; every `run.run` call takes the next of `impls` (the
// last one repeats). `build(change)` hands the watch a settled batch and resolves once the CLI
// is done with it, as core's watcher waits.
function stub(impls: RunImpl[], opts: { folderError?: OvdError } = {}) {
  let onBuild: WatchOptions['onBuild'] | undefined
  let session: LogStartOptions = {}
  let finish: (end: LogSessionEnd) => void = () => undefined
  let calls = 0
  let active = 0
  let maxActive = 0
  const stopWatch = vi.fn()
  const stopSession = vi.fn(async () => finish({ reason: 'stopped' }))
  const folder = vi.fn(async () => {
    if (opts.folderError) throw opts.folderError
    return { path: FOLDER, displayPath: '~/dev/player' }
  })
  const start = vi.fn(async (ref: string | undefined, watch: WatchOptions) => {
    onBuild = watch.onBuild
    return {
      path: FOLDER,
      displayPath: '~/dev/player',
      stop: stopWatch,
      done: new Promise<never>(() => undefined)
    }
  })
  const run = vi.fn(async (ref: string | undefined, opts: RunOptions) => {
    const impl = impls[Math.min(calls, impls.length - 1)] ?? runs()
    calls++
    active++
    maxActive = Math.max(maxActive, active)
    try {
      return await impl(ref, opts)
    } finally {
      active--
    }
  })
  const logsStart = vi.fn(async (start: LogStartOptions = {}): Promise<LogSession> => {
    session = start
    const done = new Promise<LogSessionEnd>((resolve) => {
      finish = resolve
      start.signal?.addEventListener('abort', () => resolve({ reason: 'stopped' }))
    })
    return {
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
      stop: stopSession
    }
  })
  const ovd = {
    watch: { folder, start } as unknown as Ovd['watch'],
    run: { run: run as unknown as Ovd['run']['run'] },
    logs: { start: logsStart as unknown as Ovd['logs']['start'] }
  } as Partial<Ovd>
  let interrupt = (): void => undefined
  return {
    ovd,
    folder,
    start,
    run,
    logsStart,
    stopWatch,
    stopSession,
    maxActive: () => maxActive,
    onInterrupt: (abort: () => void) => (interrupt = abort),
    interrupt: () => interrupt(),
    build: async (c: BuildChange) => {
      if (!onBuild) throw new Error('not watching')
      await onBuild(c)
    },
    emit: (entries: LogEntry[]) =>
      session.onEntries?.(entries, { lines: 0, errors: 0, shown: 0 }, []),
    restart: () => session.onRestart?.('install'),
    finish: (end: LogSessionEnd) => finish(end)
  }
}

const jsonLines = (stdout: string) =>
  stdout
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>)

const tick = () => new Promise((resolve) => setImmediate(resolve))

describe('ovd run --watch', () => {
  test('not a project folder: exit 2, nothing watched or run', async () => {
    const s = stub([runs()], {
      folderError: new OvdError(
        'NOT_A_PROJECT',
        'ovd run --watch needs a project folder',
        'Pass a project folder or open one with ovd open <folder>'
      )
    })
    const { stdout, exitCode } = await cli(['run', 'player.vpkg', '--watch', '--json'], {
      ovd: s.ovd
    })
    expect(jsonLines(stdout)).toEqual([
      {
        ok: false,
        error: {
          code: 'NOT_A_PROJECT',
          message: 'ovd run --watch needs a project folder',
          hint: 'Pass a project folder or open one with ovd open <folder>'
        }
      }
    ])
    expect(exitCode).toBe(2)
    expect(s.folder).toHaveBeenCalledWith('player.vpkg')
    expect(s.start).not.toHaveBeenCalled()
    expect(s.run).not.toHaveBeenCalled()
  })

  test('the first run, then a redeploy that waits for the session restart; Ctrl+C exits 0', async () => {
    const s = stub([runs()])
    const running = cli(['run', '--watch', '--json', '--device', 'VirtualDevice'], {
      ovd: s.ovd,
      onInterrupt: s.onInterrupt
    })
    await vi.waitFor(() => expect(s.run).toHaveBeenCalledTimes(1))
    await tick()
    // The watch starts first (its baseline), on the folder it resolved, with --device.
    expect(s.start.mock.calls[0]?.[0]).toBe(FOLDER)
    expect(s.start.mock.calls[0]?.[1]).toMatchObject({ device: 'VirtualDevice' })
    expect(s.run.mock.calls[0]?.[0]).toBe(FOLDER)
    s.emit([line(0)])

    const redeploy = s.build(change())
    await vi.waitFor(() => expect(s.run).toHaveBeenCalledTimes(2))
    expect(s.run.mock.calls[1]?.[0]).toBe(build.path)
    expect(s.run.mock.calls[1]?.[1]).toMatchObject({ device: 'VirtualDevice' })
    // The redeploy's log step waits for the running session to restart after its install.
    await tick()
    let done = false
    void redeploy.then(() => (done = true))
    await tick()
    expect(done).toBe(false)
    s.restart()
    await redeploy
    s.emit([line(1)])
    s.interrupt()
    const { stdout, stderr, exitCode } = await running

    const lines = jsonLines(stdout)
    expect(lines.filter((l) => l.ok === true)).toEqual([
      { ok: true, run: outcome },
      { ok: true, run: outcome }
    ])
    expect(lines[0]).toEqual({ ok: true, run: outcome })
    expect(lines.filter((l) => l.message !== undefined).map((l) => l.message)).toEqual([
      line(0).message,
      line(1).message
    ])
    expect(s.logsStart).toHaveBeenCalledTimes(1)
    expect(exitCode).toBe(0)
    expect(s.stopWatch).toHaveBeenCalled()
    expect(s.stopSession).toHaveBeenCalled()
    expect(stderr).toContain('Watching build/ for new builds (Ctrl+C to stop)…')
    expect(stderr).toContain('Build changed: build/aarch64-debug/player_aarch64.vpkg, redeploying…')
  })

  test('a build that settles during the first run is redeployed after it, never alongside', async () => {
    let releaseFirst = (): void => undefined
    const first: RunImpl = async (ref, opts) => {
      const result = await runs()(ref, opts)
      await new Promise<void>((resolve) => (releaseFirst = resolve))
      return result
    }
    const s = stub([first, runs()])
    const running = cli(['run', '--watch', '--json'], { ovd: s.ovd, onInterrupt: s.onInterrupt })
    await vi.waitFor(() => expect(s.run).toHaveBeenCalledTimes(1))
    await tick()

    const redeploy = s.build(change())
    await tick()
    expect(s.run).toHaveBeenCalledTimes(1)
    releaseFirst()
    await vi.waitFor(() => expect(s.run).toHaveBeenCalledTimes(2))
    s.restart()
    await redeploy
    s.interrupt()
    const { stdout, exitCode } = await running

    expect(s.maxActive()).toBe(1)
    expect(jsonLines(stdout).filter((l) => l.ok === true)).toHaveLength(2)
    expect(exitCode).toBe(0)
  })

  test('a failed redeploy prints its error, keeps the session and goes on watching', async () => {
    const s = stub([
      runs(),
      runs(new OvdError('INSTALL_FAILED', 'Install failed: disk full', 'hint')),
      runs()
    ])
    const running = cli(['run', '--watch', '--json'], { ovd: s.ovd, onInterrupt: s.onInterrupt })
    await vi.waitFor(() => expect(s.run).toHaveBeenCalledTimes(1))
    await tick()

    const failing = s.build(change())
    await vi.waitFor(() => expect(s.run).toHaveBeenCalledTimes(2))
    await tick()
    s.restart()
    await failing
    s.emit([line(7)])
    const again = s.build(change())
    await vi.waitFor(() => expect(s.run).toHaveBeenCalledTimes(3))
    await tick()
    s.restart()
    await again
    s.interrupt()
    const { stdout, exitCode } = await running

    const lines = jsonLines(stdout)
    expect(lines.map((l) => (l.ok === undefined ? 'line' : l.ok ? 'ok' : 'error'))).toEqual([
      'ok',
      'error',
      'line',
      'ok'
    ])
    expect(lines[1]).toEqual({
      ok: false,
      error: { code: 'INSTALL_FAILED', message: 'Install failed: disk full', hint: 'hint' }
    })
    expect(s.stopSession).toHaveBeenCalledTimes(1)
    expect(exitCode).toBe(0)
  })

  test('a target that can’t be read prints its error and runs nothing; watching goes on', async () => {
    const s = stub([runs()])
    const running = cli(['run', '--watch', '--json'], { ovd: s.ovd, onInterrupt: s.onInterrupt })
    await vi.waitFor(() => expect(s.run).toHaveBeenCalledTimes(1))
    await tick()

    await s.build({
      folder: { path: FOLDER, displayPath: '~/dev/player' },
      changed: [build],
      error: new OvdError(
        'TARGET_OFFLINE',
        'Vega Virtual Device is stopped',
        'Start it with ovd vvd start'
      )
    })
    await s.build({
      folder: { path: FOLDER, displayPath: '~/dev/player' },
      changed: [armv7],
      target
    })
    s.interrupt()
    const { stdout, stderr, exitCode } = await running

    expect(s.run).toHaveBeenCalledTimes(1)
    expect(jsonLines(stdout).at(-1)).toEqual({
      ok: false,
      error: {
        code: 'TARGET_OFFLINE',
        message: 'Vega Virtual Device is stopped',
        hint: 'Start it with ovd vvd start'
      }
    })
    expect(stderr).toContain('Build changed: build/aarch64-debug/player_aarch64.vpkg\n')
    expect(stderr).toContain(
      'Build changed: build/armv7-release/player_armv7.vpkg, no build for Vega Virtual Device'
    )
    expect(exitCode).toBe(0)
  })

  test('a first run that fails before its log step: the redeploy starts the session', async () => {
    const s = stub([
      runs(new OvdError('TARGET_OFFLINE', 'Vega Virtual Device is stopped', 'hint'), {
        failBeforeLogs: true
      }),
      runs()
    ])
    const running = cli(['run', '--watch', '--json'], { ovd: s.ovd, onInterrupt: s.onInterrupt })
    await vi.waitFor(() => expect(s.run).toHaveBeenCalledTimes(1))
    await tick()
    expect(s.logsStart).not.toHaveBeenCalled()

    await s.build(change())
    s.interrupt()
    const { stdout, exitCode } = await running

    expect(s.logsStart).toHaveBeenCalledTimes(1)
    expect(s.logsStart.mock.calls[0]?.[0]).toMatchObject({ device: 'VirtualDevice', capacity: 0 })
    expect(jsonLines(stdout).map((l) => l.ok)).toEqual([false, true])
    expect(exitCode).toBe(0)
  })

  test('the log stream giving up exits 1 with LOG_STREAM_ENDED last and stops the watch', async () => {
    const s = stub([runs()])
    const running = cli(['run', '--watch', '--json'], { ovd: s.ovd, onInterrupt: s.onInterrupt })
    await vi.waitFor(() => expect(s.run).toHaveBeenCalledTimes(1))
    await tick()
    s.finish({
      reason: 'ended',
      error: new OvdError('LOG_STREAM_ENDED', 'Vega Virtual Device’s log stream ended', 'hint')
    })
    const { stdout, exitCode } = await running

    const lines = jsonLines(stdout)
    expect(lines[0]).toMatchObject({ ok: true })
    expect(lines.at(-1)).toMatchObject({ ok: false, error: { code: 'LOG_STREAM_ENDED' } })
    expect(exitCode).toBe(1)
    expect(s.stopWatch).toHaveBeenCalled()
  })

  test('human: the run lines on stdout, the watch and the redeploy on stderr', async () => {
    const s = stub([runs()])
    const running = cli(['run', '--watch'], { ovd: s.ovd, onInterrupt: s.onInterrupt })
    await vi.waitFor(() => expect(s.run).toHaveBeenCalledTimes(1))
    await tick()
    s.interrupt()
    const { stdout, stderr, exitCode } = await running

    expect(stdout).toBe(
      'Installed player_aarch64.vpkg (com.example.player 1.4.2) on Vega Virtual Device · aarch64\n' +
        'Launched com.example.player.main on Vega Virtual Device · verified, pid 3571\n'
    )
    expect(stderr.split('\n')[0]).toBe('Watching build/ for new builds (Ctrl+C to stop)…')
    expect(stderr).toContain('Following the log of Vega Virtual Device (Ctrl+C to stop)…')
    expect(exitCode).toBe(0)
  })
})
