import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { OvdError } from '../../src/errors/ovdError.js'
import {
  logExport,
  logJson,
  openLogExport,
  writeLogExport,
  type LogExportFormat
} from '../../src/logs/logExport.js'
import { logText } from '../../src/logs/logText.js'
import type { LogEntry } from '../../src/logs/types.js'

// Entries as core parses them from fixtures/0.24/loggingctl-log/stick-follow.txt.
const tick = (n: number): LogEntry => ({
  seq: n,
  time: `2026-11-08T07:27:0${n}.257Z`,
  deviceTime: `Nov 08 07:27:0${n}.257342`,
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
const installed: LogEntry = {
  seq: 9,
  time: '2026-11-08T07:27:01.002Z',
  deviceTime: null,
  level: 'I',
  priority: null,
  facility: null,
  process: null,
  pid: null,
  tid: null,
  tag: 'OVD',
  message: 'Installed player_armv7.vpkg from the CLI',
  parsed: true,
  ovd: {
    kind: 'install',
    action: 'app.install',
    surface: 'cli',
    result: 'ok',
    package: 'player_armv7.vpkg'
  }
}
// An app's own `console.log` with an escape sequence, a bidi control and a second line.
const controls: LogEntry = {
  ...tick(3),
  level: 'I',
  priority: 'info',
  message: 'color \u001b[31mred\u001b[0m ‮evil\nline two'
}

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ovd-export-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const readLines = async (path: string) => (await readFile(path, 'utf8')).split('\n')

describe('logJson', () => {
  test('a device entry: the `ovd logs --json` fields, without seq or deviceTime', () => {
    expect(JSON.stringify(logJson(tick(1)))).toBe(
      '{"time":"2026-11-08T07:27:01.257Z","level":"E","priority":"err","facility":"user","process":"com.example.player","pid":27178,"tid":2842092448,"tag":"com.amazon.keplerscript","message":"[KeplerScript-JavaScript] player error tick 1","parsed":true}'
    )
  })

  test('an OVD line: {time, ovd, message}', () => {
    expect(logJson(installed)).toEqual({
      time: installed.time,
      ovd: installed.ovd,
      message: installed.message
    })
  })
})

describe('logExport', () => {
  test('text is the `ovd logs` line format, control characters escaped', () => {
    const text = logExport([tick(1), controls, installed], 'text')
    expect(text).toBe(logText(tick(1)) + logText(controls) + logText(installed))
    expect(text).not.toContain('\u001b')
    expect(text).toContain('\\x1b[31mred')
  })

  test('jsonl keeps device text exact, one parseable line per entry', () => {
    const lines = logExport([tick(1), controls, installed], 'jsonl').split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[3]).toBe('')
    expect(lines.slice(0, 3).map((l) => JSON.parse(l) as unknown)).toEqual([
      logJson(tick(1)),
      logJson(controls),
      logJson(installed)
    ])
    expect((JSON.parse(lines[1] ?? '') as { message: string }).message).toBe(controls.message)
  })

  test('no entries: empty', () => {
    expect(logExport([], 'text')).toBe('')
    expect(logExport([], 'jsonl')).toBe('')
  })
})

describe('openLogExport', () => {
  test.each<LogExportFormat>(['text', 'jsonl'])(
    '%s: batches append in order and close reports the lines',
    async (format) => {
      const path = join(dir, `out.${format}`)
      const writer = await openLogExport(path, { format, overwrite: false })
      writer.write([tick(1)])
      writer.write([])
      writer.write([installed, tick(2)])
      expect(await writer.close()).toEqual({ path, format, lines: 3 })
      expect(writer.created()).toBe(true)
      expect(await readFile(path, 'utf8')).toBe(logExport([tick(1), installed, tick(2)], format))
    }
  )

  test('jsonl reads back line by line with JSON.parse', async () => {
    const path = join(dir, 'out.jsonl')
    const writer = await openLogExport(path, { format: 'jsonl', overwrite: false })
    writer.write([tick(1), controls])
    writer.write([installed])
    await writer.close()
    const lines = await readLines(path)
    expect(lines.at(-1)).toBe('')
    expect(lines.slice(0, -1).map((l) => JSON.parse(l) as unknown)).toEqual(
      [tick(1), controls, installed].map(logJson)
    )
  })

  test('a relative path resolves to an absolute one', async () => {
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir)
    try {
      const writer = await openLogExport('rel.txt', { format: 'text', overwrite: false })
      expect(writer.path).toBe(join(dir, 'rel.txt'))
      await writer.discard()
    } finally {
      cwd.mockRestore()
    }
  })

  test('an existing file is refused without overwrite and left as it was', async () => {
    const path = join(dir, 'kept.txt')
    await writeFile(path, 'before\n')
    await expect(openLogExport(path, { format: 'text', overwrite: false })).rejects.toMatchObject({
      code: 'EXPORT_FILE_EXISTS',
      message: `${path} already exists`
    })
    expect(await readFile(path, 'utf8')).toBe('before\n')
  })

  test('overwrite replaces an existing file, but only once something is written or it closes', async () => {
    const path = join(dir, 'kept.txt')
    await writeFile(path, 'before, a much longer text than the export\n')
    const writer = await openLogExport(path, { format: 'text', overwrite: true })
    expect(await readFile(path, 'utf8')).toContain('before')
    writer.write([tick(1)])
    await writer.close()
    expect(await readFile(path, 'utf8')).toBe(logText(tick(1)))
    expect(writer.created()).toBe(false)
  })

  test('close with nothing written leaves an empty file', async () => {
    const path = join(dir, 'empty.txt')
    const writer = await openLogExport(path, { format: 'text', overwrite: false })
    expect(await writer.close()).toMatchObject({ lines: 0 })
    expect(await readFile(path, 'utf8')).toBe('')
  })

  test('discard before any write leaves no file, and an existing target untouched', async () => {
    const fresh = join(dir, 'fresh.txt')
    await (await openLogExport(fresh, { format: 'text', overwrite: false })).discard()
    await expect(stat(fresh)).rejects.toMatchObject({ code: 'ENOENT' })

    const kept = join(dir, 'kept.txt')
    await writeFile(kept, 'before\n')
    await (await openLogExport(kept, { format: 'text', overwrite: true })).discard()
    expect(await readFile(kept, 'utf8')).toBe('before\n')
  })

  test('discard after writes removes a file it created', async () => {
    const path = join(dir, 'made.txt')
    const writer = await openLogExport(path, { format: 'text', overwrite: false })
    writer.write([tick(1)])
    await writer.discard()
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test.each([
    ['a missing folder', (d: string) => join(d, 'missing', 'out.txt')],
    ['a folder at the path', (d: string) => d]
  ])('%s: EXPORT_FAILED before anything is opened', async (_name, pathOf) => {
    await expect(
      openLogExport(pathOf(dir), { format: 'text', overwrite: true })
    ).rejects.toMatchObject({ code: 'EXPORT_FAILED' })
  })

  test('a file in place of the folder: EXPORT_FAILED', async () => {
    await writeFile(join(dir, 'file'), '')
    await expect(
      openLogExport(join(dir, 'file', 'out.txt'), { format: 'text', overwrite: false })
    ).rejects.toMatchObject({ code: 'EXPORT_FAILED', hint: expect.any(String) })
  })

  test.skipIf(process.getuid?.() === 0)(
    'a read-only folder: EXPORT_FAILED with the errno',
    async () => {
      const folder = join(dir, 'ro')
      await mkdir(folder)
      await chmod(folder, 0o500)
      try {
        await expect(
          openLogExport(join(folder, 'out.txt'), { format: 'text', overwrite: false })
        ).rejects.toMatchObject({
          code: 'EXPORT_FAILED',
          message: expect.stringContaining('EACCES')
        })
      } finally {
        await chmod(folder, 0o700)
      }
    }
  )

  test('a file created after the check: EXPORT_FILE_EXISTS from the open, reported once', async () => {
    const path = join(dir, 'race.txt')
    const errors: OvdError[] = []
    const writer = await openLogExport(path, {
      format: 'text',
      overwrite: false,
      onError: (error) => errors.push(error)
    })
    await writeFile(path, 'someone else\n')
    writer.write([tick(1)])
    writer.write([tick(2)])
    await expect(writer.close()).rejects.toMatchObject({ code: 'EXPORT_FILE_EXISTS' })
    expect(errors.map((e) => e.code)).toEqual(['EXPORT_FILE_EXISTS'])
    expect(await readFile(path, 'utf8')).toBe('someone else\n')
  })

  test('a folder removed after the check: EXPORT_FAILED through onError and close', async () => {
    const folder = join(dir, 'gone')
    await mkdir(folder)
    const onError = vi.fn()
    const writer = await openLogExport(join(folder, 'out.txt'), {
      format: 'jsonl',
      overwrite: false,
      onError
    })
    await rm(folder, { recursive: true })
    writer.write([tick(1)])
    await expect(writer.close()).rejects.toMatchObject({
      code: 'EXPORT_FAILED',
      message: expect.stringContaining('ENOENT')
    })
    expect(onError).toHaveBeenCalledTimes(1)
  })
})

describe('writeLogExport', () => {
  test('writes the entries at once', async () => {
    const path = join(dir, 'once.jsonl')
    expect(
      await writeLogExport(path, [tick(1), installed], { format: 'jsonl', overwrite: true })
    ).toEqual({
      path,
      format: 'jsonl',
      lines: 2
    })
    expect(await readFile(path, 'utf8')).toBe(logExport([tick(1), installed], 'jsonl'))
  })
})
