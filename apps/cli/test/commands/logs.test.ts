import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  logText,
  OvdError,
  type ErrorCode,
  type LogEntry,
  type LogSession,
  type LogSessionEnd,
  type LogStartOptions,
  type Ovd
} from '@ovd/core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cli } from '../support/runCli.js'

// Entries as core parses them from fixtures/0.24/loggingctl-log/stick-follow.txt.
const errorTick = (n: number, seq: number): LogEntry => ({
  seq,
  time: `2026-11-08T07:27:0${n - 1}.257Z`,
  deviceTime: `Nov 08 07:27:0${n - 1}.257342`,
  level: 'E',
  priority: 'err',
  facility: 'user',
  process: 'com.example.player',
  pid: 27178,
  tid: 2842092448,
  tag: 'com.amazon.keplerscript',
  message: `[KeplerScript-JavaScript] player error tick ${n}`,
  parsed: true
})
const multi: LogEntry = {
  ...errorTick(1, 2),
  level: 'I',
  priority: 'info',
  message: '[KeplerScript-JavaScript] player multi\nline two\nline three'
}
const ovdLine = (message: string, ovd: LogEntry['ovd'], seq = 9): LogEntry => ({
  seq,
  time: '2026-11-08T07:27:01.002Z',
  deviceTime: null,
  level: 'I',
  priority: null,
  facility: null,
  process: null,
  pid: null,
  tid: null,
  tag: 'OVD',
  message,
  parsed: true,
  ...(ovd ? { ovd } : {})
})
const installed = ovdLine('Installed player_armv7.vpkg from the CLI', {
  kind: 'install',
  action: 'app.install',
  surface: 'cli',
  result: 'ok',
  package: 'player_armv7.vpkg'
})
const system: LogEntry = {
  seq: 3,
  time: '2026-11-08T07:27:00.300Z',
  deviceTime: 'Nov 08 07:27:00.300000',
  level: 'I',
  priority: 'info',
  facility: 'daemon',
  process: 'systemd',
  pid: null,
  tid: null,
  tag: 'systemd',
  message: 'Starting Gracefull reboot',
  parsed: true
}

interface Stub {
  ovd: Partial<Ovd>
  start: ReturnType<typeof vi.fn>
  finish: (end: LogSessionEnd) => void
}

// A core whose `logs.start` replays `batches` through `onEntries`, then waits for `finish`
// (or the caller's abort, which ends it as stopped).
function stubLogs(batches: LogEntry[][], opts: { failWith?: ErrorCode } = {}): Stub {
  let finish: (end: LogSessionEnd) => void = () => undefined
  const start = vi.fn(async (start: LogStartOptions = {}) => {
    if (opts.failWith) throw new OvdError(opts.failWith, `failed: ${opts.failWith}`, 'hint')
    const done = new Promise<LogSessionEnd>((resolve) => {
      finish = resolve
      start.signal?.addEventListener('abort', () => resolve({ reason: 'stopped' }))
    })
    for (const entries of batches) {
      start.onEntries?.(entries, { lines: entries.length, errors: 0, shown: entries.length }, [])
    }
    const session: LogSession = {
      target: { id: 'G070000000000001', name: 'Fire TV stick' },
      command: 'vega exec vda -s G070000000000001 shell loggingctl log -f -o short_concise',
      startedAt: '2026-11-08T07:27:00.000Z',
      done,
      setFilter: () => undefined,
      entries: () => [],
      counts: () => ({ lines: 0, errors: 0, shown: 0 }),
      apps: () => [],
      clear: () => undefined,
      state: () => 'following',
      setRestartAfterInstall: () => undefined,
      stop: async () => undefined
    }
    return session
  })
  const ovd = {
    logs: { start: start as unknown as Ovd['logs']['start'] }
  } as Partial<Ovd>
  return { ovd, start, finish: (end) => finish(end) }
}

// Runs `ovd <args>` and ends the session with `end` once it started.
async function run(
  args: string[],
  stub: Stub,
  end: LogSessionEnd = { reason: 'until' },
  opts: { tty?: boolean; env?: Record<string, string> } = {}
) {
  const running = cli(args, { ovd: stub.ovd, ...opts })
  await vi.waitFor(() => expect(stub.start).toHaveBeenCalled())
  await new Promise((resolve) => setImmediate(resolve))
  stub.finish(end)
  return running
}

describe('ovd logs', () => {
  test('--json prints one JSON line per entry, without seq or deviceTime', async () => {
    const stub = stubLogs([[errorTick(1, 0)], [errorTick(2, 1), multi]])
    const { stdout, stderr, exitCode } = await run(['logs', '--json'], stub)
    const lines = stdout
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toEqual({
      time: '2026-11-08T07:27:00.257Z',
      level: 'E',
      priority: 'err',
      facility: 'user',
      process: 'com.example.player',
      pid: 27178,
      tid: 2842092448,
      tag: 'com.amazon.keplerscript',
      message: '[KeplerScript-JavaScript] player error tick 1',
      parsed: true
    })
    expect(lines[2]?.message).toBe('[KeplerScript-JavaScript] player multi\nline two\nline three')
    expect(stderr).toBe('Following the log of Fire TV stick (Ctrl+C to stop)…\n')
    expect(exitCode).toBe(0)
  })

  test('passes the filter flags and the device to core', async () => {
    const stub = stubLogs([])
    await run(
      [
        'logs',
        '--app',
        'com.example.player',
        '--level',
        'error',
        '--since',
        '5m',
        '--until',
        '07:30',
        '--grep',
        'tick',
        '--regex',
        '--device',
        'G070000000000001'
      ],
      stub
    )
    expect(stub.start).toHaveBeenCalledWith(
      expect.objectContaining({
        device: 'G070000000000001',
        capacity: 0,
        filter: {
          app: 'com.example.player',
          level: 'error',
          since: '5m',
          until: '07:30',
          search: 'tick',
          regex: true
        }
      })
    )
  })

  test('--system is passed as such', async () => {
    const stub = stubLogs([])
    await run(['logs', '--system'], stub)
    expect(stub.start).toHaveBeenCalledWith(expect.objectContaining({ filter: { system: true } }))
  })

  test('an empty batch writes nothing', async () => {
    const stub = stubLogs([[], []])
    const { stdout, exitCode } = await run(['logs', '--json'], stub)
    expect(stdout).toBe('')
    expect(exitCode).toBe(0)
  })

  test('human output: one aligned line per entry, continuation lines indented', async () => {
    const stub = stubLogs([[multi, system]])
    const { stdout } = await run(['logs'], stub)
    const lines = stdout.split('\n')
    expect(lines).toHaveLength(5)
    expect(lines[0]).toMatch(
      /^\d{2}:\d{2}:\d{2}\.\d{3} I com\.amazon\.keplerscript {3}27178 \[KeplerScript-JavaScript\] player multi$/
    )
    const column = (lines[0] ?? '').indexOf('[KeplerScript')
    expect(lines[1]).toBe(`${' '.repeat(column)}line two`)
    expect(lines[3]).toMatch(/ I systemd {18} {5}- Starting Gracefull reboot$/)
    expect(stdout).not.toContain('\u001b[')
  })

  test.each<[string, { tty?: boolean; env?: Record<string, string> }, boolean]>([
    ['a terminal', { tty: true }, true],
    ['a terminal with NO_COLOR', { tty: true, env: { NO_COLOR: '1' } }, false],
    ['a pipe', {}, false]
  ])('colors the level letter only on %s', async (_n, opts, colored) => {
    const stub = stubLogs([[errorTick(1, 0)]])
    const { stdout } = await run(['logs'], stub, { reason: 'until' }, opts)
    expect(stdout.includes('\u001b[31mE\u001b[0m')).toBe(colored)
  })

  test('Ctrl+C stops the session and exits 0', async () => {
    const stub = stubLogs([[errorTick(1, 0)]])
    let interrupt = (): void => undefined
    const running = cli(['logs', '--json'], {
      ovd: stub.ovd,
      onInterrupt: (abort) => (interrupt = abort)
    })
    await vi.waitFor(() => expect(stub.start).toHaveBeenCalled())
    await new Promise((resolve) => setImmediate(resolve))
    interrupt()
    const { stdout, exitCode } = await running
    expect(stdout.trim().split('\n')).toHaveLength(1)
    expect(exitCode).toBe(0)
  })

  test('Ctrl+C before the stream started exits 0', async () => {
    const start = vi.fn(async (opts: LogStartOptions = {}) => {
      await new Promise<void>((resolve) =>
        opts.signal?.addEventListener('abort', () => resolve(), { once: true })
      )
      const error = new Error('The operation was aborted')
      error.name = 'AbortError'
      throw error
    })
    let interrupt = (): void => undefined
    const running = cli(['logs', '--json'], {
      ovd: { logs: { start: start as unknown as Ovd['logs']['start'] } },
      onInterrupt: (abort) => (interrupt = abort)
    })
    await vi.waitFor(() => expect(start).toHaveBeenCalled())
    interrupt()
    expect(await running).toEqual({ stdout: '', stderr: '', exitCode: 0 })
  })

  test('a session that gives up reconnecting exits 1 with LOG_STREAM_ENDED as the last JSON line', async () => {
    const stub = stubLogs([
      [system],
      [ovdLine('Device dropped · reconnecting…', { kind: 'disconnected' })]
    ])
    const error = new OvdError('LOG_STREAM_ENDED', 'Fire TV stick’s log stream ended', 'hint', {
      exitCode: 0
    })
    const { stdout, exitCode } = await run(['logs', '--json'], stub, { reason: 'ended', error })
    const lines = stdout
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as unknown)
    expect(lines).toHaveLength(3)
    expect(lines[1]).toEqual({
      time: '2026-11-08T07:27:01.002Z',
      ovd: { kind: 'disconnected' },
      message: 'Device dropped · reconnecting…'
    })
    expect(lines.at(-1)).toMatchObject({ ok: false, error: { code: 'LOG_STREAM_ENDED' } })
    expect(exitCode).toBe(1)
  })

  test('--json prints an OVD line as {time, ovd, message}', async () => {
    const stub = stubLogs([[installed]])
    const { stdout } = await run(['logs', '--json'], stub)
    expect(JSON.parse(stdout.trim())).toEqual({
      time: '2026-11-08T07:27:01.002Z',
      ovd: {
        kind: 'install',
        action: 'app.install',
        surface: 'cli',
        result: 'ok',
        package: 'player_armv7.vpkg'
      },
      message: 'Installed player_armv7.vpkg from the CLI'
    })
  })

  test.each<[string, { tty?: boolean }, boolean]>([
    ['a terminal', { tty: true }, true],
    ['a pipe', {}, false]
  ])(
    'human output prints HH:MM:SS.mmm OVD <message>, colored only on %s',
    async (_n, opts, colored) => {
      const stub = stubLogs([[installed]])
      const { stdout } = await run(['logs'], stub, { reason: 'until' }, opts)
      const plain = new RegExp(
        String.raw`^\d{2}:\d{2}:\d{2}\.\d{3} OVD Installed player_armv7\.vpkg from the CLI\n$`
      )
      if (colored) {
        expect(stdout).toContain('\u001b[32mOVD\u001b[0m')
        expect(stdout.replace('\u001b[32m', '').replace('\u001b[0m', '')).toMatch(plain)
      } else {
        expect(stdout).toMatch(plain)
      }
    }
  )

  test('--no-restart-after-install starts the session with restartAfterInstall false; the default is true', async () => {
    const off = stubLogs([])
    await run(['logs', '--no-restart-after-install'], off)
    expect(off.start).toHaveBeenCalledWith(expect.objectContaining({ restartAfterInstall: false }))
    const on = stubLogs([])
    await run(['logs'], on)
    expect(on.start).toHaveBeenCalledWith(expect.objectContaining({ restartAfterInstall: true }))
  })

  test('a stream that ends by itself prints the error on stderr in human mode', async () => {
    const stub = stubLogs([])
    const error = new OvdError('LOG_STREAM_ENDED', 'Fire TV stick’s log stream ended', 'hint')
    const { stdout, stderr, exitCode } = await run(['logs'], stub, { reason: 'ended', error })
    expect(stdout).toBe('')
    expect(stderr).toContain('Error: Fire TV stick’s log stream ended\nhint\n')
    expect(exitCode).toBe(1)
  })

  test.each<[ErrorCode, number]>([
    ['NO_TARGET', 4],
    ['TARGET_OFFLINE', 4],
    ['SDK_NOT_FOUND', 3],
    ['INVALID_LOG_FILTER', 2],
    ['INVALID_APP_ID', 2]
  ])('a start error %s exits %i', async (code, exit) => {
    const stub = stubLogs([], { failWith: code })
    const { stdout, exitCode } = await cli(['logs', '--json'], { ovd: stub.ovd })
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code } })
    expect(exitCode).toBe(exit)
  })

  test('--app with --system is a usage error without calling core', async () => {
    const stub = stubLogs([])
    const { exitCode } = await cli(['logs', '--app', 'com.example.player', '--system'], {
      ovd: stub.ovd
    })
    expect(exitCode).toBe(2)
    expect(stub.start).not.toHaveBeenCalled()
  })

  test('--app without a value is a usage error', async () => {
    const stub = stubLogs([])
    const { exitCode } = await cli(['logs', '--app'], { ovd: stub.ovd })
    expect(exitCode).toBe(2)
    expect(stub.start).not.toHaveBeenCalled()
  })
})

describe('ovd logs --export', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ovd-cli-export-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  const linesOf = async (path: string) => (await readFile(path, 'utf8')).split('\n')

  test('--format jsonl writes the --json line of each entry; stdout says where', async () => {
    const file = join(dir, 'player.jsonl')
    const stub = stubLogs([[errorTick(1, 0)], [installed, multi]])
    const { stdout, stderr, exitCode } = await run(
      ['logs', '--export', file, '--format', 'jsonl'],
      stub
    )
    const lines = await linesOf(file)
    expect(lines.at(-1)).toBe('')
    const parsed = lines.slice(0, -1).map((l) => JSON.parse(l) as Record<string, unknown>)
    expect(parsed).toHaveLength(3)
    expect(parsed[0]).toEqual({
      time: '2026-11-08T07:27:00.257Z',
      level: 'E',
      priority: 'err',
      facility: 'user',
      process: 'com.example.player',
      pid: 27178,
      tid: 2842092448,
      tag: 'com.amazon.keplerscript',
      message: '[KeplerScript-JavaScript] player error tick 1',
      parsed: true
    })
    expect(parsed[1]).toEqual({
      time: installed.time,
      ovd: installed.ovd,
      message: installed.message
    })
    expect(parsed[2]?.message).toBe(multi.message)
    expect(stdout).toBe(`Exported 3 lines to ${file}\n`)
    expect(stderr).toBe(`Exporting the log of Fire TV stick to ${file} (Ctrl+C to stop)…\n`)
    expect(exitCode).toBe(0)
  })

  test('the default format is the ovd logs text, uncolored on a terminal', async () => {
    const file = join(dir, 'player.txt')
    const stub = stubLogs([[errorTick(1, 0), system]])
    const { exitCode } = await run(
      ['logs', '--export', file],
      stub,
      { reason: 'until' },
      { tty: true }
    )
    expect(await readFile(file, 'utf8')).toBe(logText(errorTick(1, 0)) + logText(system))
    expect(exitCode).toBe(0)
  })

  test('--json prints one document with the path, format and lines', async () => {
    const file = join(dir, 'player.txt')
    const stub = stubLogs([[errorTick(1, 0)], [errorTick(2, 1)]])
    const { stdout, exitCode } = await run(['logs', '--export', file, '--json'], stub)
    expect(stdout.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(stdout)).toEqual({ ok: true, path: file, format: 'text', lines: 2 })
    expect(exitCode).toBe(0)
  })

  test('an existing file is refused with EXPORT_FILE_EXISTS (exit 2), unchanged, no session', async () => {
    const file = join(dir, 'kept.txt')
    await writeFile(file, 'before\n')
    const stub = stubLogs([[errorTick(1, 0)]])
    const { stdout, exitCode } = await cli(['logs', '--export', file, '--json'], {
      ovd: stub.ovd
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'EXPORT_FILE_EXISTS' } })
    expect(exitCode).toBe(2)
    expect(stub.start).not.toHaveBeenCalled()
    expect(await readFile(file, 'utf8')).toBe('before\n')
  })

  test('--force replaces an existing file', async () => {
    const file = join(dir, 'kept.txt')
    await writeFile(file, 'before, longer than the export would be on its own line\n')
    const stub = stubLogs([[errorTick(1, 0)]])
    const { exitCode } = await run(['logs', '--export', file, '--force'], stub)
    expect(await readFile(file, 'utf8')).toBe(logText(errorTick(1, 0)))
    expect(exitCode).toBe(0)
  })

  test('a missing folder: EXPORT_FAILED (exit 1) with the error document, no session', async () => {
    const file = join(dir, 'missing', 'player.txt')
    const stub = stubLogs([])
    const { stdout, exitCode } = await cli(['logs', '--export', file, '--json'], { ovd: stub.ovd })
    expect(JSON.parse(stdout)).toMatchObject({
      ok: false,
      error: { code: 'EXPORT_FAILED', hint: expect.any(String) }
    })
    expect(exitCode).toBe(1)
    expect(stub.start).not.toHaveBeenCalled()
  })

  test.each([
    ['--format', ['--format', 'jsonl']],
    ['--force', ['--force']],
    ['an unknown --format', ['--export', 'out.csv', '--format', 'csv']]
  ])('%s without --export or a known format is a usage error', async (_name, args) => {
    const stub = stubLogs([])
    const { exitCode } = await cli(['logs', ...args], { ovd: stub.ovd })
    expect(exitCode).toBe(2)
    expect(stub.start).not.toHaveBeenCalled()
  })

  test('a stream that gives up still closes the file, then prints the error document (exit 1)', async () => {
    const file = join(dir, 'partial.jsonl')
    const stub = stubLogs([
      [errorTick(1, 0)],
      [ovdLine('Device dropped · reconnecting…', { kind: 'disconnected' })]
    ])
    const error = new OvdError('LOG_STREAM_ENDED', 'Fire TV stick’s log stream ended', 'hint')
    const { stdout, exitCode } = await run(
      ['logs', '--export', file, '--format', 'jsonl', '--json'],
      stub,
      { reason: 'ended', error }
    )
    expect((await linesOf(file)).slice(0, -1).map((l) => JSON.parse(l) as unknown)).toEqual([
      expect.objectContaining({ message: '[KeplerScript-JavaScript] player error tick 1' }),
      expect.objectContaining({ ovd: { kind: 'disconnected' } })
    ])
    expect(stdout.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'LOG_STREAM_ENDED' } })
    expect(exitCode).toBe(1)
  })

  test('a write that fails stops the session and exits 1 with EXPORT_FAILED', async () => {
    const file = join(dir, 'taken.txt')
    const stub = stubLogs([[errorTick(1, 0)]])
    const start = stub.start as unknown as Ovd['logs']['start']
    // The path passes the preflight, then becomes a folder before the first write: opening it
    // fails with EISDIR (on macOS and Linux, also as root).
    const ovd = {
      logs: {
        start: (async (opts: LogStartOptions) => {
          await mkdir(file)
          return start(opts)
        }) as unknown as Ovd['logs']['start']
      }
    } as Partial<Ovd>
    // The session is never finished here: the command only ends because the failed write
    // aborted it.
    const { stdout, exitCode } = await cli(['logs', '--export', file, '--force', '--json'], {
      ovd
    })
    expect(stdout.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(stdout)).toMatchObject({
      ok: false,
      error: { code: 'EXPORT_FAILED', hint: expect.any(String) }
    })
    expect(exitCode).toBe(1)
    const [started] = stub.start.mock.calls[0] as [LogStartOptions]
    expect(started.signal?.aborted).toBe(true)
  })

  test('a start that fails leaves no file, and an existing --force target unchanged', async () => {
    const fresh = join(dir, 'fresh.txt')
    const failing = stubLogs([], { failWith: 'TARGET_OFFLINE' })
    const first = await cli(['logs', '--export', fresh, '--json'], { ovd: failing.ovd })
    expect(JSON.parse(first.stdout)).toMatchObject({ ok: false, error: { code: 'TARGET_OFFLINE' } })
    expect(first.exitCode).toBe(4)
    await expect(stat(fresh)).rejects.toMatchObject({ code: 'ENOENT' })

    const kept = join(dir, 'kept.txt')
    await writeFile(kept, 'before\n')
    const second = await cli(['logs', '--export', kept, '--force'], { ovd: failing.ovd })
    expect(second.exitCode).toBe(4)
    expect(await readFile(kept, 'utf8')).toBe('before\n')
  })

  test('Ctrl+C before the stream started exits 0 and leaves no file', async () => {
    const file = join(dir, 'early.txt')
    const start = vi.fn(async (opts: LogStartOptions = {}) => {
      await new Promise<void>((resolve) =>
        opts.signal?.addEventListener('abort', () => resolve(), { once: true })
      )
      const error = new Error('The operation was aborted')
      error.name = 'AbortError'
      throw error
    })
    let interrupt = (): void => undefined
    const running = cli(['logs', '--export', file], {
      ovd: { logs: { start: start as unknown as Ovd['logs']['start'] } },
      onInterrupt: (abort) => (interrupt = abort)
    })
    await vi.waitFor(() => expect(start).toHaveBeenCalled())
    interrupt()
    expect(await running).toEqual({ stdout: '', stderr: '', exitCode: 0 })
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('Ctrl+C after lines arrived keeps them and reports the export', async () => {
    const file = join(dir, 'stopped.txt')
    const stub = stubLogs([[errorTick(1, 0)]])
    let interrupt = (): void => undefined
    const running = cli(['logs', '--export', file, '--json'], {
      ovd: stub.ovd,
      onInterrupt: (abort) => (interrupt = abort)
    })
    await vi.waitFor(() => expect(stub.start).toHaveBeenCalled())
    await new Promise((resolve) => setImmediate(resolve))
    interrupt()
    const { stdout, exitCode } = await running
    expect(JSON.parse(stdout)).toEqual({ ok: true, path: file, format: 'text', lines: 1 })
    expect(await readFile(file, 'utf8')).toBe(logText(errorTick(1, 0)))
    expect(exitCode).toBe(0)
  })
})
