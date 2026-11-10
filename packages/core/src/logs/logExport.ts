import { constants } from 'node:fs'
import { access, open, stat, unlink, type FileHandle } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { OvdError } from '../errors/ovdError.js'
import { logText } from './logText.js'
import type { LogEntry, OvdEvent } from './types.js'

// The formats a log export is written in: `text` is the `ovd logs` line format (`logText`),
// `jsonl` one `ovd logs --json` line per entry.
export const LOG_EXPORT_FORMATS = ['text', 'jsonl'] as const
export type LogExportFormat = (typeof LOG_EXPORT_FORMATS)[number]

// One line of `ovd logs --json` and of a JSON-lines export: a public contract (ADR 0006), so
// the fields are picked explicitly (`seq` and `deviceTime` stay internal). An OVD line has its
// own shape. Device text stays exact: JSON escapes control characters itself.
export type LogJson =
  | { time: string; ovd: OvdEvent; message: string }
  | {
      time: string
      level: LogEntry['level']
      priority: string | null
      facility: string | null
      process: string | null
      pid: number | null
      tid: number | null
      tag: string
      message: string
      parsed: boolean
    }

export function logJson(entry: LogEntry): LogJson {
  if (entry.ovd !== undefined) return { time: entry.time, ovd: entry.ovd, message: entry.message }
  return {
    time: entry.time,
    level: entry.level,
    priority: entry.priority,
    facility: entry.facility,
    process: entry.process,
    pid: entry.pid,
    tid: entry.tid,
    tag: entry.tag,
    message: entry.message,
    parsed: entry.parsed
  }
}

// The entries as the file's text in `format`, every line ending in `\n`.
export function logExport(entries: LogEntry[], format: LogExportFormat): string {
  if (format === 'jsonl')
    return entries.map((entry) => `${JSON.stringify(logJson(entry))}\n`).join('')
  return entries.map((entry) => logText(entry)).join('')
}

export interface LogExportResult {
  // Absolute.
  path: string
  format: LogExportFormat
  lines: number
}

export interface LogExportOptions {
  format: LogExportFormat
  // Replace an existing file (`--force`; the desktop's save dialog already asked).
  overwrite: boolean
  // A write failed: later writes are dropped and `close()` rejects with the same error. Called
  // once, so a follower can stop its session.
  onError?: (error: OvdError) => void
}

export interface LogExportWriter {
  path: string
  // Queues the entries; the file is opened on the first non-empty batch.
  write(entries: LogEntry[]): void
  // Waits for the queued writes and closes the file, creating (or emptying) it when nothing
  // was written: a run that ended normally always leaves its file.
  close(): Promise<LogExportResult>
  // For a run that never started: closes the file and removes it if this writer created it.
  // A path it never opened is left as it was (an existing `--force` target is untouched).
  discard(): Promise<void>
  // This writer created the file (it didn't exist before).
  created(): boolean
}

// Opens a log export at `path`. It checks eagerly that the file can be written (an existing
// file without `overwrite` is EXPORT_FILE_EXISTS; a missing or read-only folder, or a folder at
// the path, is EXPORT_FAILED), but opens the file lazily: an existing file is only truncated
// once there's something to write or the run ends normally, never by a start that fails.
export async function openLogExport(
  path: string,
  opts: LogExportOptions
): Promise<LogExportWriter> {
  const full = resolve(path)
  const existed = await preflight(full, opts.overwrite)
  let handle: FileHandle | undefined
  let created = false
  let position = 0
  let lines = 0
  let failure: OvdError | undefined
  let chain: Promise<void> = Promise.resolve()

  const ensureOpen = async (): Promise<FileHandle> => {
    if (handle) return handle
    try {
      handle = await open(full, opts.overwrite ? 'w' : 'wx')
    } catch (error) {
      throw exportError(full, error)
    }
    created = !existed
    return handle
  }

  const fail = (error: unknown) => {
    if (failure) return
    failure = exportError(full, error)
    opts.onError?.(failure)
  }

  const enqueue = (step: () => Promise<void>) => {
    chain = chain.then(async () => {
      if (failure) return
      try {
        await step()
      } catch (error) {
        fail(error)
      }
    })
  }

  return {
    path: full,
    write(entries) {
      if (entries.length === 0 || failure) return
      const data = Buffer.from(logExport(entries, opts.format), 'utf8')
      lines += entries.length
      enqueue(async () => {
        const file = await ensureOpen()
        let offset = 0
        // A write may take fewer bytes than asked; write the rest from where it stopped.
        while (offset < data.length) {
          const { bytesWritten } = await file.write(data, offset, data.length - offset, position)
          offset += bytesWritten
          position += bytesWritten
        }
      })
    },
    async close() {
      enqueue(async () => {
        await ensureOpen()
      })
      await chain
      const file = handle
      handle = undefined
      if (file) {
        try {
          await file.close()
        } catch (error) {
          fail(error)
        }
      }
      if (failure) throw failure
      return { path: full, format: opts.format, lines }
    },
    async discard() {
      await chain
      const file = handle
      handle = undefined
      await file?.close().catch(() => undefined)
      if (created) await unlink(full).catch(() => undefined)
    },
    created: () => created
  }
}

// Writes `entries` to `path` at once (the desktop's Export).
export async function writeLogExport(
  path: string,
  entries: LogEntry[],
  opts: Omit<LogExportOptions, 'onError'>
): Promise<LogExportResult> {
  const writer = await openLogExport(path, opts)
  writer.write(entries)
  return writer.close()
}

// Whether the file exists, once it's known it can be written.
async function preflight(path: string, overwrite: boolean): Promise<boolean> {
  let existing
  try {
    existing = await stat(path)
  } catch (error) {
    if (errnoOf(error) !== 'ENOENT') throw exportError(path, error)
  }
  if (existing) {
    if (existing.isDirectory()) {
      throw new OvdError(
        'EXPORT_FAILED',
        `Can’t export to ${path}: it’s a folder`,
        'Give a file name inside the folder'
      )
    }
    if (!overwrite) {
      throw new OvdError(
        'EXPORT_FILE_EXISTS',
        `${path} already exists`,
        'Pass --force to replace it, or choose another file'
      )
    }
    await access(path, constants.W_OK).catch((error: unknown) => {
      throw exportError(path, error)
    })
    return true
  }
  const folder = dirname(path)
  let parent
  try {
    parent = await stat(folder)
  } catch (error) {
    throw exportError(path, error)
  }
  if (!parent.isDirectory())
    throw exportError(path, Object.assign(new Error(), { code: 'ENOTDIR' }))
  await access(folder, constants.W_OK).catch((error: unknown) => {
    throw exportError(path, error)
  })
  return false
}

function exportError(path: string, error: unknown): OvdError {
  if (error instanceof OvdError) return error
  const code = errnoOf(error)
  if (code === 'EEXIST') {
    return new OvdError(
      'EXPORT_FILE_EXISTS',
      `${path} already exists`,
      'Pass --force to replace it, or choose another file'
    )
  }
  const reason = code ?? (error instanceof Error ? error.message : String(error))
  return new OvdError(
    'EXPORT_FAILED',
    `Can’t write ${path} (${reason})`,
    'Check that the folder exists, that you can write to it and that the disk isn’t full',
    code === undefined ? undefined : { errno: code }
  )
}

function errnoOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}
