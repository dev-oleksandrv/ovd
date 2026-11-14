import { deflateRawSync } from 'node:zlib'
import { crc32 } from './crc32.js'

/** No zip64: the whole archive, and the data going into it, stays under 2 GiB. */
export const MAX_ARCHIVE_BYTES = 2 * 1024 ** 3

const MAX_NAME_BYTES = 255
const MAX_ENTRIES = 0xffff

const LOCAL_SIGNATURE = 0x04034b50
const CENTRAL_SIGNATURE = 0x02014b50
const END_SIGNATURE = 0x06054b50
const LOCAL_HEADER_BYTES = 30
const CENTRAL_HEADER_BYTES = 46
const END_RECORD_BYTES = 22

const VERSION_NEEDED = 20
// Host 3 (Unix) so the external attributes below are read as a mode.
const VERSION_MADE_BY = (3 << 8) | 20
const FLAG_UTF8 = 0x0800
const METHOD_STORE = 0
const METHOD_DEFLATE = 8
// A regular file, owner read/write only: a bundle holds device logs.
const EXTERNAL_ATTRIBUTES = (0o100600 << 16) >>> 0

export interface ZipEntryInput {
  name: string
  data: Buffer | string
}

export interface WriteZipOptions {
  /** Time stamped on every entry. Defaults to now; pass one for reproducible output. */
  modified?: Date
  /** Upper limit for the input data and the finished archive. Defaults to 2 GiB. */
  maxBytes?: number
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipError'
  }
}

// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

// Entry names end up as paths when someone extracts the archive, so anything
// that could land outside the target folder or break a tool is refused.
function validateName(name: string): Buffer {
  const fail = (why: string): never => {
    throw new ZipError(`Unsafe archive entry name ${JSON.stringify(name)}: ${why}`)
  }
  if (name === '') fail('empty')
  if (name.startsWith('/')) fail('absolute path')
  if (/^[A-Za-z]:/.test(name)) fail('drive letter')
  if (name.includes('\\')) fail('backslash')
  if (CONTROL_CHARACTERS.test(name)) fail('control character')
  for (const segment of name.split('/')) {
    // This also catches a trailing slash (a directory entry) and `//`.
    if (segment === '') fail('empty path segment')
    if (segment === '.' || segment === '..') fail(`"${segment}" segment`)
  }
  const bytes = Buffer.from(name, 'utf8')
  if (bytes.length > MAX_NAME_BYTES) fail(`longer than ${MAX_NAME_BYTES} bytes`)
  return bytes
}

// DOS time has no zone and a 1980-2107 range. UTC keeps the output the same on
// every machine.
function toDos(date: Date): { time: number; date: number } {
  const earliest = Date.UTC(1980, 0, 1)
  const latest = Date.UTC(2107, 11, 31, 23, 59, 58)
  const ms = Math.min(Math.max(date.getTime(), earliest), latest)
  const d = new Date(Number.isNaN(ms) ? earliest : ms)
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate()
  }
}

/** Writes a zip archive in memory: deflate where it helps, UTF-8 names, no zip64. */
export function writeZip(entries: readonly ZipEntryInput[], options: WriteZipOptions = {}): Buffer {
  const maxBytes = options.maxBytes ?? MAX_ARCHIVE_BYTES
  const stamp = toDos(options.modified ?? new Date())
  if (entries.length > MAX_ENTRIES)
    throw new ZipError(`Too many archive entries (${entries.length})`)

  const seen = new Set<string>()
  const prepared = entries.map((entry) => {
    const nameBytes = validateName(entry.name)
    if (seen.has(entry.name))
      throw new ZipError(`Duplicate archive entry name ${JSON.stringify(entry.name)}`)
    seen.add(entry.name)
    const data = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data
    return { nameBytes, data }
  })

  // Checked before compressing so an oversized input is refused cheaply.
  const inputBytes = prepared.reduce((sum, e) => sum + e.data.length, 0)
  if (inputBytes > maxBytes) {
    throw new ZipError(`Archive input is ${inputBytes} bytes, over the ${maxBytes} byte limit`)
  }

  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const { nameBytes, data } of prepared) {
    const deflated = data.length === 0 ? data : deflateRawSync(data)
    const useDeflate = data.length > 0 && deflated.length < data.length
    const body = useDeflate ? deflated : data
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE
    const crc = crc32(data)

    const local = Buffer.alloc(LOCAL_HEADER_BYTES + nameBytes.length)
    local.writeUInt32LE(LOCAL_SIGNATURE, 0)
    local.writeUInt16LE(VERSION_NEEDED, 4)
    local.writeUInt16LE(FLAG_UTF8, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    nameBytes.copy(local, LOCAL_HEADER_BYTES)

    const central = Buffer.alloc(CENTRAL_HEADER_BYTES + nameBytes.length)
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0)
    central.writeUInt16LE(VERSION_MADE_BY, 4)
    central.writeUInt16LE(VERSION_NEEDED, 6)
    central.writeUInt16LE(FLAG_UTF8, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(stamp.time, 12)
    central.writeUInt16LE(stamp.date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    // Extra, comment, disk number and internal attributes stay 0.
    central.writeUInt32LE(EXTERNAL_ATTRIBUTES, 38)
    central.writeUInt32LE(offset, 42)
    nameBytes.copy(central, CENTRAL_HEADER_BYTES)

    locals.push(local, body)
    centrals.push(central)
    offset += local.length + body.length
    if (offset > maxBytes) throw new ZipError(`Archive is over the ${maxBytes} byte limit`)
  }

  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0)
  const total = offset + centralSize + END_RECORD_BYTES
  if (total > maxBytes)
    throw new ZipError(`Archive is ${total} bytes, over the ${maxBytes} byte limit`)

  const end = Buffer.alloc(END_RECORD_BYTES)
  end.writeUInt32LE(END_SIGNATURE, 0)
  end.writeUInt16LE(prepared.length, 8)
  end.writeUInt16LE(prepared.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end], total)
}
