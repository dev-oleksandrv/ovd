import { statSync } from 'node:fs'
import { open, stat, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { z } from 'zod'
import { ERROR_CODES } from '../errors/ovdError.js'
import { ACTIVITY_ACTIONS, SURFACES, type ActivityEntry } from './activityLog.js'

// How often the feed looks for new lines in `activity.jsonl`.
export const ACTIVITY_POLL_MS = 500
// A poll reads at most this much of what was appended; the rest waits for the next poll, so a
// huge or endless append can't exhaust memory.
export const ACTIVITY_POLL_BYTES = 1024 * 1024
// It reads in chunks of at most this size.
export const ACTIVITY_CHUNK_BYTES = 64 * 1024
// A line longer than this is dropped, whether it arrives in one poll or spans several (then the
// rest of it is skipped up to its newline).
export const ACTIVITY_MAX_PARTIAL = 64 * 1024
// No entry OVD writes carries a longer arg; a longer one is not an entry to trust.
export const ACTIVITY_MAX_ARG = 4096

export interface ActivityFeed {
  // Calls `listener` with every valid entry appended after the first subscriber, in file order.
  // Returns the unsubscribe.
  subscribe(listener: (entry: ActivityEntry) => void): () => void
}

const ActivityEntrySchema = z.object({
  time: z.iso.datetime(),
  surface: z.enum(SURFACES),
  action: z.enum(ACTIVITY_ACTIONS),
  target: z.string().nullable(),
  args: z.record(z.string(), z.union([z.string().max(ACTIVITY_MAX_ARG), z.number(), z.boolean()])),
  result: z.enum(['ok', 'error']),
  errorCode: z.enum(ERROR_CODES).optional()
})

// Tails `activity.jsonl` (ADR 0011). Entries of every OVD process arrive alike (CLI, desktop,
// the session's own), which is how an install in one surface restarts the log stream of another.
export function createActivityFeed(opts: { home: string; pollMs?: number }): ActivityFeed {
  const file = join(opts.home, 'activity.jsonl')
  const pollMs = opts.pollMs ?? ACTIVITY_POLL_MS
  const listeners = new Set<(entry: ActivityEntry) => void>()
  let offset = 0
  let partial = ''
  // Dropping an over-long line: everything up to the next newline is skipped.
  let skipping = false
  let decoder = new StringDecoder('utf8')
  let timer: ReturnType<typeof setTimeout> | undefined
  // A poll started before the last unsubscribe delivers nothing and doesn't re-arm.
  let generation = 0

  const arm = (gen: number) => {
    if (gen !== generation || listeners.size === 0) return
    timer = setTimeout(() => {
      timer = undefined
      void poll(gen).finally(() => arm(gen))
    }, pollMs)
    timer.unref()
  }

  const reset = () => {
    offset = 0
    partial = ''
    skipping = false
    decoder = new StringDecoder('utf8')
  }

  // Splits decoded text into lines and delivers each valid entry.
  const take = (text: string) => {
    let rest = text
    if (skipping) {
      const newline = rest.indexOf('\n')
      if (newline === -1) return
      skipping = false
      rest = rest.slice(newline + 1)
    }
    const pieces = (partial + rest).split('\n')
    partial = pieces.pop() ?? ''
    if (partial.length > ACTIVITY_MAX_PARTIAL) {
      partial = ''
      skipping = true
    }
    for (const line of pieces) {
      // The first piece already holds `partial`, so this counts the whole line.
      if (line.length > ACTIVITY_MAX_PARTIAL) continue
      const entry = parseLine(line)
      if (entry) for (const listener of [...listeners]) listener(entry)
    }
  }

  const poll = async (gen: number) => {
    // Decoded chunks, delivered once reading is done (at most ACTIVITY_POLL_BYTES of them).
    const texts: string[] = []
    let handle: FileHandle | undefined
    try {
      const size = await sizeOf(file)
      if (gen !== generation) return
      // Rotated to `activity.1.jsonl`: the new file is read from its start.
      if (size < offset) reset()
      if (size <= offset) return
      const end = Math.min(size, offset + ACTIVITY_POLL_BYTES)
      handle = await open(file, 'r')
      const buffer = Buffer.alloc(Math.min(ACTIVITY_CHUNK_BYTES, end - offset))
      while (offset < end) {
        const length = Math.min(buffer.length, end - offset)
        const { bytesRead } = await handle.read(buffer, 0, length, offset)
        if (gen !== generation) return
        if (bytesRead === 0) break
        // The offset moves by exactly what was read, so the next poll goes on from there.
        offset += bytesRead
        texts.push(decoder.write(buffer.subarray(0, bytesRead)))
      }
    } catch {
      // Anything but a missing file (handled in `sizeOf`) counts as nothing new; what was read
      // before the error is still delivered, as the offset has moved past it.
    } finally {
      await handle?.close().catch(() => undefined)
    }
    if (gen !== generation) return
    for (const text of texts) take(text)
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) {
        // Synchronous on purpose: "entries appended after subscribe" is then exact, and the
        // caller needs no async step before it acts (the log session spawns its stream next).
        offset = sizeSync(file)
        arm(generation)
      }
      return () => {
        if (!listeners.delete(listener) || listeners.size > 0) return
        generation++
        if (timer !== undefined) clearTimeout(timer)
        timer = undefined
        reset()
      }
    }
  }
}

function parseLine(line: string): ActivityEntry | undefined {
  if (line.trim() === '') return undefined
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  const parsed = ActivityEntrySchema.safeParse(value)
  if (!parsed.success) return undefined
  const { errorCode, ...rest } = parsed.data
  return errorCode === undefined ? rest : { ...rest, errorCode }
}

function sizeSync(file: string): number {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

async function sizeOf(file: string): Promise<number> {
  try {
    return (await stat(file)).size
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0
    throw error
  }
}
