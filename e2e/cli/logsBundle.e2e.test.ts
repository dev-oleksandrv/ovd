import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'
import { ovd } from '../harness/cli.ts'
import { createSandbox, type Sandbox } from '../harness/vitest.ts'

function withStick(): Sandbox {
  const sandbox = createSandbox({
    stick: usbStick(),
    logStream: { ends: false, holdAfterLine: null, recording: 'presets', burst: true }
  })
  sandbox.installSdk()
  return sandbox
}

// One file of the bundle, read with the system `unzip`.
const unzipped = (zip: string, file: string): string =>
  execFileSync('unzip', ['-p', zip, file], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

describe('ovd logs bundle', () => {
  test('writes a zip with the log, the manifest and the warning (--json)', async () => {
    const sandbox = withStick()
    const out = join(sandbox.home, 'issue.zip')
    const run = await ovd(sandbox, [
      'logs',
      'bundle',
      '--pid',
      '31000',
      '--duration',
      '1',
      '--out',
      out,
      '--json'
    ])
    expect(run.exitCode).toBe(0)
    const result = run.json<{
      ok: boolean
      device: { id: string; name: string }
      path: string
      bytes: number
      lines: number
      files: string[]
    }>()
    expect(result).toMatchObject({
      ok: true,
      path: out,
      device: { id: STICK_SERIAL }
    })
    expect(result.files).toEqual(
      expect.arrayContaining(['README.txt', 'manifest.json', 'logs.txt', 'logs.jsonl'])
    )
    expect(existsSync(out)).toBe(true)
    expect(result.bytes).toBeGreaterThan(0)
    // The filter reached the capture: only the burst process is in the bundle.
    const lines = unzipped(out, 'logs.jsonl').split('\n').filter(Boolean)
    expect(lines).toHaveLength(result.lines)
    expect(result.lines).toBe(50)
    for (const line of lines) expect(JSON.parse(line)).toMatchObject({ pid: 31000 })
    expect(unzipped(out, 'logs.txt').split('\n').filter(Boolean)).toHaveLength(50)
    expect(unzipped(out, 'README.txt')).toContain('may hold tokens, user data or addresses')
    const manifest = JSON.parse(unzipped(out, 'manifest.json')) as Record<string, unknown>
    expect(manifest).toMatchObject({ lines: 50 })
    expect(JSON.stringify(manifest)).not.toContain(sandbox.home)
  }, 60_000)

  test('human output is one line: path, size, line count and the warning', async () => {
    const sandbox = withStick()
    const out = join(sandbox.home, 'human.zip')
    const run = await ovd(sandbox, ['logs', 'bundle', '--duration', '1', '--out', out])
    expect(run.exitCode).toBe(0)
    expect(run.stdout.split('\n').filter(Boolean)).toHaveLength(1)
    expect(run.stdout).toMatch(new RegExp(`^Wrote ${out.replace(/\./g, '\\.')} \\(`))
    expect(run.stdout).toMatch(
      / lines\)\. The logs in this bundle are copied as the device printed/
    )
  }, 60_000)

  test('a saved filter is used by name; an existing file needs --force', async () => {
    const sandbox = withStick()
    const out = join(sandbox.home, 'saved.zip')
    expect(
      (await ovd(sandbox, ['logs', 'filter', 'save', 'burst', '--pid', '31000'])).exitCode
    ).toBe(0)
    const args = ['logs', 'bundle', '--preset', 'burst', '--duration', '1', '--out', out, '--json']
    const first = await ovd(sandbox, args)
    expect(first.exitCode).toBe(0)
    expect(first.json<{ lines: number }>().lines).toBe(50)

    writeFileSync(join(sandbox.home, 'marker.txt'), 'x')
    const before = readFileSync(out)
    const refused = await ovd(sandbox, args)
    expect(refused.exitCode).toBe(2)
    expect(refused.json()).toMatchObject({ ok: false, error: { code: 'EXPORT_FILE_EXISTS' } })
    expect(readFileSync(out).equals(before)).toBe(true)

    const forced = await ovd(sandbox, [...args, '--force'])
    expect(forced.exitCode).toBe(0)
  }, 90_000)

  test('an unknown preset exits 2; an invalid --duration exits 2', async () => {
    const sandbox = withStick()
    const unknown = await ovd(sandbox, ['logs', 'bundle', '--preset', 'nope', '--json'])
    expect(unknown.exitCode).toBe(2)
    expect(unknown.json()).toMatchObject({ ok: false, error: { code: 'UNKNOWN_LOG_PRESET' } })
    const duration = await ovd(sandbox, ['logs', 'bundle', '--duration', '301', '--json'])
    expect(duration.exitCode).toBe(2)
    expect(duration.json()).toMatchObject({ ok: false, error: { code: 'INVALID_TIMEOUT' } })
  })

  test('an offline target exits 4', async () => {
    const sandbox = withStick()
    const run = await ovd(sandbox, ['logs', 'bundle', '--device', 'VirtualDevice', '--json'])
    expect(run.exitCode).toBe(4)
    expect(run.json()).toMatchObject({ ok: false, error: { code: 'TARGET_OFFLINE' } })
  })
})
