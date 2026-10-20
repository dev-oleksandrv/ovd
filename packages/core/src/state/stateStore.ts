import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

const savedDeviceSchema = z.object({
  id: z.string(),
  serial: z.string(),
  savedAt: z.string()
})

const hostStateSchema = z.object({
  version: z.literal(1),
  target: z.string().optional(),
  // Device names keyed by serial, so a stick keeps its name over USB and Wi‑Fi.
  names: z.record(z.string(), z.string()),
  saved: z.array(savedDeviceSchema)
})

export type SavedDevice = z.infer<typeof savedDeviceSchema>
export type HostState = z.infer<typeof hostStateSchema>

export const emptyState: HostState = { version: 1, names: {}, saved: [] }

export interface StateStore {
  read(): Promise<{ state: HostState; recovered: boolean }>
  update(fn: (state: HostState) => HostState): Promise<HostState>
}

export function createStateStore(home: string): StateStore {
  const file = join(home, 'state.json')

  async function read(): Promise<{ state: HostState; recovered: boolean }> {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch (error) {
      if (isNotFound(error)) return { state: emptyState, recovered: false }
      throw error
    }
    const parsed = hostStateSchema.safeParse(parseJson(text))
    if (parsed.success) return { state: parsed.data, recovered: false }
    // Never fail a command over a bad state file: keep a copy for the user and start over.
    await rename(file, `${file}.bak`)
    return { state: emptyState, recovered: true }
  }

  async function update(fn: (state: HostState) => HostState): Promise<HostState> {
    const next = hostStateSchema.parse(fn((await read()).state))
    await mkdir(home, { recursive: true, mode: 0o700 })
    // Write then rename, so a crash or a concurrent reader never sees a half-written file.
    const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    await rename(tmp, file)
    return next
  }

  return { read, update }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
