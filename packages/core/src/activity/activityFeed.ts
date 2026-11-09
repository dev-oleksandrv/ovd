import { statSync } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { z } from 'zod'
import { ERROR_CODES } from '../errors/ovdError.js'
import { ACTIVITY_ACTIONS, SURFACES, type ActivityEntry } from './activityLog.js'

// How often the feed looks for new lines in `activity.jsonl`.
export const ACTIVITY_POLL_MS = 500

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
  args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
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

  const poll = async (gen: number) => {
    let text: string
    try {
      const size = await sizeOf(file)
      if (gen !== generation) return
      if (size < offset) {
        // Rotated to `activity.1.jsonl`: the new file is read from its start.
        offset = 0
        partial = ''
        decoder = new StringDecoder('utf8')
      }
      if (size <= offset) return
      const bytes = await readRange(file, offset, size)
      if (gen !== generation) return
      offset += bytes.length
      text = decoder.write(bytes)
    } catch {
      // Anything but a missing file (handled in `sizeOf`) counts as nothing new.
      return
    }
    const pieces = (partial + text).split('\n')
    partial = pieces.pop() ?? ''
    for (const line of pieces) {
      const entry = parseLine(line)
      if (entry) for (const listener of [...listeners]) listener(entry)
    }
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
        offset = 0
        partial = ''
        decoder = new StringDecoder('utf8')
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

async function readRange(file: string, from: number, to: number): Promise<Buffer> {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(to - from)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, from)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}
