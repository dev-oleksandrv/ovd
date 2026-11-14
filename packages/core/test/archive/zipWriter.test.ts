import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { crc32 } from '../../src/archive/crc32.js'
import { MAX_ARCHIVE_BYTES, writeZip, ZipError } from '../../src/archive/zipWriter.js'

interface ParsedEntry {
  name: string
  data: Buffer
  method: number
  flags: number
  dosTime: number
  dosDate: number
}

// An independent reader: it walks the central directory, then checks each
// local header against it, the CRC and the inflated content.
function parseZip(zip: Buffer): ParsedEntry[] {
  const eocd = zip.length - 22
  expect(zip.readUInt32LE(eocd)).toBe(0x06054b50)
  expect(zip.readUInt16LE(eocd + 4)).toBe(0)
  expect(zip.readUInt16LE(eocd + 20)).toBe(0)
  const count = zip.readUInt16LE(eocd + 10)
  expect(zip.readUInt16LE(eocd + 8)).toBe(count)
  const cdSize = zip.readUInt32LE(eocd + 12)
  const cdOffset = zip.readUInt32LE(eocd + 16)
  expect(cdOffset + cdSize).toBe(eocd)

  const entries: ParsedEntry[] = []
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50)
    const flags = zip.readUInt16LE(p + 8)
    const method = zip.readUInt16LE(p + 10)
    const dosTime = zip.readUInt16LE(p + 12)
    const dosDate = zip.readUInt16LE(p + 14)
    const crc = zip.readUInt32LE(p + 16)
    const csize = zip.readUInt32LE(p + 20)
    const usize = zip.readUInt32LE(p + 24)
    const nlen = zip.readUInt16LE(p + 28)
    const elen = zip.readUInt16LE(p + 30)
    const clen = zip.readUInt16LE(p + 32)
    const local = zip.readUInt32LE(p + 42)
    const name = zip.subarray(p + 46, p + 46 + nlen).toString('utf8')
    p += 46 + nlen + elen + clen

    expect(zip.readUInt32LE(local)).toBe(0x04034b50)
    expect(zip.readUInt16LE(local + 6)).toBe(flags)
    expect(zip.readUInt16LE(local + 8)).toBe(method)
    expect(zip.readUInt32LE(local + 14)).toBe(crc)
    expect(zip.readUInt32LE(local + 18)).toBe(csize)
    expect(zip.readUInt32LE(local + 22)).toBe(usize)
    const lnlen = zip.readUInt16LE(local + 26)
    const lelen = zip.readUInt16LE(local + 28)
    expect(zip.subarray(local + 30, local + 30 + lnlen).toString('utf8')).toBe(name)
    const start = local + 30 + lnlen + lelen
    const raw = zip.subarray(start, start + csize)
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw)
    expect(data.length).toBe(usize)
    expect(crc32(data)).toBe(crc)
    entries.push({ name, data, method, flags, dosTime, dosDate })
  }
  expect(p).toBe(eocd)
  return entries
}

const unzipPresent = spawnSync('unzip', ['-v']).status === 0

describe('writeZip', () => {
  test('round-trips text and binary entries byte for byte', () => {
    const binary = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7) & 0xff))
    const text = 'line one\nline two\n'.repeat(500)
    const zip = writeZip([
      { name: 'logs/app.log', data: text },
      { name: 'raw.bin', data: binary }
    ])
    const entries = parseZip(zip)
    expect(entries.map((e) => e.name)).toEqual(['logs/app.log', 'raw.bin'])
    expect(entries[0]?.data.toString('utf8')).toBe(text)
    expect(entries[1]?.data.equals(binary)).toBe(true)
  })

  test('deflates compressible data and stores empty or incompressible data', () => {
    let seed = 12345
    const noise = Buffer.alloc(256)
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      noise[i] = (seed >> 16) & 0xff
    }
    const entries = parseZip(
      writeZip([
        { name: 'big.txt', data: 'a'.repeat(10_000) },
        { name: 'empty.txt', data: '' },
        { name: 'noise.bin', data: noise }
      ])
    )
    expect(entries.map((e) => e.method)).toEqual([8, 0, 0])
    expect(entries[2]?.data.equals(noise)).toBe(true)
  })

  test('writes an empty archive', () => {
    const zip = writeZip([])
    expect(zip.length).toBe(22)
    expect(parseZip(zip)).toEqual([])
  })

  test('sets the UTF-8 flag and keeps non-ASCII names', () => {
    const [entry] = parseZip(writeZip([{ name: 'журнал/日本語.log', data: 'x' }]))
    expect(entry?.name).toBe('журнал/日本語.log')
    expect((entry?.flags ?? 0) & 0x0800).toBe(0x0800)
  })

  test('encodes the modified date as DOS time (UTC, 2 s steps)', () => {
    const [entry] = parseZip(
      writeZip([{ name: 'a', data: 'x' }], {
        modified: new Date(Date.UTC(2026, 10, 14, 13, 45, 31))
      })
    )
    expect(entry?.dosDate).toBe(((2026 - 1980) << 9) | (11 << 5) | 14)
    expect(entry?.dosTime).toBe((13 << 11) | (45 << 5) | 15)
  })

  test('clamps dates before 1980 and after 2107', () => {
    const early = parseZip(writeZip([{ name: 'a', data: 'x' }], { modified: new Date(0) }))[0]
    expect(early?.dosDate).toBe((0 << 9) | (1 << 5) | 1)
    expect(early?.dosTime).toBe(0)
    const late = parseZip(
      writeZip([{ name: 'a', data: 'x' }], { modified: new Date(Date.UTC(3000, 0, 1)) })
    )[0]
    expect(late?.dosDate).toBe((127 << 9) | (12 << 5) | 31)
    expect(late?.dosTime).toBe((23 << 11) | (59 << 5) | 29)
  })

  test('is deterministic for the same input and date', () => {
    const modified = new Date(Date.UTC(2026, 0, 2, 3, 4, 6))
    const input = [{ name: 'a.log', data: 'hello '.repeat(100) }]
    expect(writeZip(input, { modified }).equals(writeZip(input, { modified }))).toBe(true)
  })

  test('allows ".." inside a segment and nested folders', () => {
    const names = ['a..b.log', 'dir/..hidden', 'x/y/z.txt', 'with space.txt']
    expect(
      parseZip(writeZip(names.map((name) => ({ name, data: 'x' })))).map((e) => e.name)
    ).toEqual(names)
  })

  describe('name rules', () => {
    test.each([
      ['empty', ''],
      ['absolute', '/etc/passwd'],
      ['drive letter', 'C:/x.log'],
      ['drive letter without slash', 'c:x.log'],
      ['backslash', 'a\\b.log'],
      ['dot', '.'],
      ['dot segment', 'a/./b'],
      ['parent', '..'],
      ['leading parent', '../x'],
      ['inner parent', 'a/../b'],
      ['trailing parent', 'a/..'],
      ['empty segment', 'a//b'],
      ['trailing slash', 'dir/'],
      ['NUL', 'a\u0000b'],
      ['newline', 'a\nb'],
      ['escape', 'a\u001bb'],
      ['DEL', 'a\u007fb'],
      ['over 255 bytes', 'a'.repeat(256)],
      ['over 255 bytes in UTF-8', 'я'.repeat(128)]
    ])('refuses %s', (_label, name) => {
      expect(() => writeZip([{ name, data: 'x' }])).toThrow(ZipError)
    })

    test('accepts exactly 255 bytes', () => {
      const name = 'a'.repeat(255)
      expect(parseZip(writeZip([{ name, data: 'x' }]))[0]?.name).toBe(name)
    })

    test('refuses duplicate names', () => {
      expect(() =>
        writeZip([
          { name: 'a.log', data: 'x' },
          { name: 'a.log', data: 'y' }
        ])
      ).toThrow(ZipError)
    })
  })

  describe('size limit', () => {
    test('defaults to 2 GiB', () => {
      expect(MAX_ARCHIVE_BYTES).toBe(2 * 1024 ** 3)
    })

    test('refuses input over maxBytes before compressing', () => {
      expect(() => writeZip([{ name: 'a', data: 'x'.repeat(101) }], { maxBytes: 100 })).toThrow(
        ZipError
      )
    })

    test('counts every entry together', () => {
      const input = [
        { name: 'a', data: 'x'.repeat(60) },
        { name: 'b', data: 'y'.repeat(60) }
      ]
      expect(() => writeZip(input, { maxBytes: 100 })).toThrow(ZipError)
    })

    test('refuses an archive whose headers push it past maxBytes', () => {
      expect(() => writeZip([{ name: 'a', data: 'x' }], { maxBytes: 50 })).toThrow(ZipError)
    })

    test('accepts data under maxBytes', () => {
      expect(
        parseZip(writeZip([{ name: 'a', data: 'x'.repeat(10) }], { maxBytes: 1000 }))
      ).toHaveLength(1)
    })
  })

  describe.skipIf(!unzipPresent)('host unzip', () => {
    let dir = ''
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'ovd-zip-'))
    })
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true })
    })

    test('unzip -t accepts the archive and -p returns the exact bytes', async () => {
      const binary = Buffer.from(Array.from({ length: 3000 }, (_, i) => (i * 13) & 0xff))
      const text = 'päivää ✓\n'.repeat(300)
      const file = join(dir, 'bundle.zip')
      await writeFile(
        file,
        writeZip([
          { name: 'logs/app.log', data: text },
          { name: 'empty.txt', data: '' },
          { name: 'raw.bin', data: binary }
        ])
      )
      const test = spawnSync('unzip', ['-t', file], { encoding: 'utf8' })
      expect(test.status).toBe(0)
      expect(test.stdout).toContain('No errors detected')

      const text2 = spawnSync('unzip', ['-p', file, 'logs/app.log'])
      expect(text2.stdout.toString('utf8')).toBe(text)
      const bin = spawnSync('unzip', ['-p', file, 'raw.bin'])
      expect(bin.stdout.equals(binary)).toBe(true)
      const empty = spawnSync('unzip', ['-p', file, 'empty.txt'])
      expect(empty.stdout.length).toBe(0)
    })
  })
})
