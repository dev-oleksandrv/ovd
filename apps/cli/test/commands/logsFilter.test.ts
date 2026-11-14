import { OvdError, type LogStartOptions, type Ovd } from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import { cli } from '../support/runCli.js'

// A core that records `logs.start` and ends the session at once.
function startStub() {
  const start = vi.fn(async (_opts: LogStartOptions) => ({
    target: { id: 'X', name: 'Fire TV stick' },
    done: Promise.resolve({ reason: 'until' as const })
  }))
  return start
}

describe('routing', () => {
  test('`logs filter list`, `save`, `rm` and `bundle` reach their own commands; `logs` keeps its flags', async () => {
    const list = vi.fn(async () => [])
    const save = vi.fn(async (name: string, filter: object) => ({ name, filter }))
    const remove = vi.fn(async (name: string) => ({ name }))
    const bundle = vi.fn(async () => ({
      device: { id: 'X', name: 'Fire TV stick' },
      path: '/tmp/b.zip',
      bytes: 2048,
      lines: 7,
      files: ['README.txt']
    }))
    const start = startStub()
    const ovd = {
      logs: { presets: () => [{ key: 'errors', label: 'Errors', filter: {} }], start },
      logFilters: { list, save, remove, resolve: vi.fn() },
      logBundle: { bundle }
    } as unknown as Partial<Ovd>

    const l = await cli(['logs', 'filter', 'list', '--json'], { ovd })
    expect(JSON.parse(l.stdout)).toEqual({
      ok: true,
      presets: [{ name: 'errors', label: 'Errors', builtin: true }],
      filters: []
    })

    const s = await cli(
      ['logs', 'filter', 'save', 'mine', '--level', 'error', '--force', '--json'],
      {
        ovd
      }
    )
    expect(JSON.parse(s.stdout)).toEqual({
      ok: true,
      filter: { name: 'mine', filter: { level: 'error' } }
    })
    expect(save).toHaveBeenCalledWith('mine', { level: 'error' }, { force: true })

    const r = await cli(['logs', 'filter', 'rm', 'mine', '--json'], { ovd })
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, name: 'mine' })

    const b = await cli(['logs', 'bundle', '--level', 'warn', '--duration', '9', '--force'], {
      ovd
    })
    expect(b.exitCode).toBe(0)
    expect(b.stdout).toMatch(/^Wrote \/tmp\/b\.zip \(2\.0 KB, 7 lines\)\. The logs in this bundle/)
    expect(bundle).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { level: 'warn' }, durationS: 9, force: true })
    )

    const g = await cli(['logs', '--level', 'warn', '--force'], { ovd })
    expect(g.stderr).toContain('--force needs --export')
    expect(start).not.toHaveBeenCalled()
  })
})

describe('ovd logs filter flags', () => {
  const run = async (args: string[], resolve = vi.fn()) => {
    const start = startStub()
    const ovd = { logs: { start }, logFilters: { resolve } } as unknown as Partial<Ovd>
    const result = await cli(['logs', ...args], { ovd })
    return { ...result, start, resolve }
  }

  test('repeatable flags gather into arrays and rules merge per identity', async () => {
    const { start } = await run([
      '--pid',
      '1',
      '--pid',
      '2',
      '--tid',
      '3',
      '--tag',
      'a',
      '--identity',
      'i',
      '--facility',
      'user',
      '--boot',
      'current',
      '--process-level',
      'com.example.player=warn',
      '--process-rate',
      'com.example.player=10',
      '--mute',
      'noisy'
    ])
    expect(start.mock.calls[0]?.[0].filter).toEqual({
      pid: ['1', '2'],
      tid: ['3'],
      tag: ['a'],
      identity: ['i'],
      facility: ['user'],
      boot: ['current'],
      processRules: [
        { identity: 'com.example.player', level: 'warn', rate: '10' },
        { identity: 'noisy', mute: true }
      ]
    })
  })

  test('--preset resolves through core with the explicit flags as overrides', async () => {
    const resolve = vi.fn(async () => ({ level: 'error', search: 'x' }))
    const { start } = await run(['--preset', 'mine', '--level', 'error'], resolve)
    expect(resolve).toHaveBeenCalledWith('mine', { level: 'error' })
    expect(start.mock.calls[0]?.[0].filter).toEqual({ level: 'error', search: 'x' })
  })

  test('an unknown preset exits 2', async () => {
    const resolve = vi.fn(async () => {
      throw new OvdError('UNKNOWN_LOG_PRESET', 'No preset nope', 'hint')
    })
    const { exitCode, stderr } = await run(['--preset', 'nope'], resolve)
    expect(exitCode).toBe(2)
    expect(stderr).toContain('No preset nope')
  })

  test.each(['--process-rate', '--process-level'])(
    '%s without = is INVALID_LOG_FILTER (2)',
    async (flag) => {
      const { exitCode, stdout } = await run([flag, 'noequals', '--json'])
      expect(exitCode).toBe(2)
      expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'INVALID_LOG_FILTER' } })
    }
  )

  test('an invalid --duration is INVALID_TIMEOUT (2) and never calls core', async () => {
    const bundle = vi.fn()
    const { exitCode } = await cli(['logs', 'bundle', '--duration', '0'], {
      ovd: { logBundle: { bundle } } as unknown as Partial<Ovd>
    })
    expect(exitCode).toBe(2)
    expect(bundle).not.toHaveBeenCalled()
  })

  test('a bundle resolves --preset and passes the filter with the name', async () => {
    const bundle = vi.fn(async () => ({
      device: { id: 'X', name: 'n' },
      path: '/p.zip',
      bytes: 1,
      lines: 0,
      files: []
    }))
    await cli(['logs', 'bundle', '--preset', 'network', '--out', 'x.zip', '--json'], {
      ovd: {
        logBundle: { bundle },
        logFilters: { resolve: vi.fn(async () => ({ search: 'http' })) }
      } as unknown as Partial<Ovd>
    })
    expect(bundle).toHaveBeenCalledWith(
      expect.objectContaining({ preset: 'network', out: 'x.zip', filter: { search: 'http' } })
    )
  })
})
