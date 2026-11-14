import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

// Writes `value` as JSON to `file`: the folder is created 0700, the data goes to a 0600 temp
// file next to it, and a rename publishes it, so a crash or a concurrent reader never sees a
// half-written file. Two writers are last-writer-wins (ADR 0022, ADR 0026).
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
  try {
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    await rename(tmp, file)
  } catch (error) {
    // Best effort: a failed write mustn't leave temp files behind.
    await rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}
