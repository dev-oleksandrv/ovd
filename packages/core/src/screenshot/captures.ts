import { open, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { PNG_HEADER_BYTES, pngSize } from './png.js'

// One screenshot in the captures folder, as the Captures list shows it.
export interface Capture {
  name: string
  path: string
  bytes: number
  width: number
  height: number
  // The file's modification time, ISO 8601.
  takenAt: string
}

export interface CapturesList {
  dir: string
  captures: Capture[]
}

const SLUG_MAX = 40

// Where screenshots go: `OVD_CAPTURES` if set, else `~/ovd/captures`. The user's own files, not
// host state (ADR 0022, Amendments), so it isn't under `OVD_HOME`.
export function capturesDir(env: Record<string, string | undefined>, homedir: string): string {
  const override = env.OVD_CAPTURES
  return override ? resolve(homedir, override) : join(homedir, 'ovd', 'captures')
}

// A file-name-safe form of a device name: lowercase `a-z0-9` runs joined by `-`, at most 40
// characters, `device` when nothing is left (`../x` → `x`, an emoji-only name → `device`).
export function slug(name: string): string {
  const runs = name.toLowerCase().match(/[a-z0-9]+/g) ?? []
  const joined = runs.join('-').slice(0, SLUG_MAX).replace(/-+$/, '')
  return joined === '' ? 'device' : joined
}

const pad = (n: number) => String(n).padStart(2, '0')

// `<device-slug>-YYYYMMDD-HHMMSS` in local time, without the extension.
export function captureBase(deviceName: string, at: Date): string {
  const day = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  return `${slug(deviceName)}-${day}-${time}`
}

// The n-th candidate name for a base: `base.png`, then `base-2.png`, `base-3.png`…
export function captureName(base: string, n: number): string {
  return n === 1 ? `${base}.png` : `${base}-${n}.png`
}

// The newest `limit` PNGs in `dir`, newest first. Only visible `*.png` files whose header is a
// PNG's are listed, so the hidden `.part` temp files and anything else are skipped. A missing
// folder is an empty list.
export async function listCaptures(dir: string, limit: number): Promise<Capture[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error) {
    if (isErrno(error, 'ENOENT') || isErrno(error, 'ENOTDIR')) return []
    throw error
  }
  const found = await Promise.all(
    names
      .filter((name) => !name.startsWith('.') && name.toLowerCase().endsWith('.png'))
      .map((name) => readCapture(join(dir, name), name))
  )
  return found
    .filter((capture): capture is Capture => capture !== null)
    .sort((a, b) => b.takenAt.localeCompare(a.takenAt) || a.name.localeCompare(b.name))
    .slice(0, limit)
}

// Reads only the header: the size comes from IHDR, never from decoding the whole file.
async function readCapture(path: string, name: string): Promise<Capture | null> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return null
    const file = await open(path, 'r')
    try {
      const header = new Uint8Array(PNG_HEADER_BYTES)
      const { bytesRead } = await file.read(header, 0, PNG_HEADER_BYTES, 0)
      const size = pngSize(header.subarray(0, bytesRead))
      if (!size) return null
      return { name, path, bytes: info.size, ...size, takenAt: info.mtime.toISOString() }
    } finally {
      await file.close()
    }
  } catch {
    // Removed or unreadable between the listing and the read: not a capture to show.
    return null
  }
}

export function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code
}
