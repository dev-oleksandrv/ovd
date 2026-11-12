import { constants } from 'node:fs'
import { copyFile, link, mkdir, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { OvdError } from '../errors/ovdError.js'
import { captureName, isErrno } from './captures.js'

// Where a screenshot goes, decided before any SDK call. `auto`: a new default name in `dir`
// (`-2`, `-3`… when taken), created when `create` is set (the captures folder). `file`: exactly
// `path`; an existing file is replaced only with `force`.
export type Destination =
  { kind: 'auto'; dir: string; create: boolean } | { kind: 'file'; path: string; force: boolean }

// The file system calls the final step makes, injectable so a test can refuse hard links.
export interface SaveFs {
  link: (from: string, to: string) => Promise<void>
  copyFile: (from: string, to: string, mode: number) => Promise<void>
  rename: (from: string, to: string) => Promise<void>
}

export const nodeSaveFs: SaveFs = { link, copyFile, rename }

const MAX_SUFFIX = 1_000
const PNG = /\.png$/i

// `--out`, resolved against `cwd`: an existing folder gets a default name inside it; anything
// else must be a `.png` file in an existing folder. An existing file needs `force`.
export async function resolveDestination(opts: {
  out: string | undefined
  force: boolean
  cwd: string
  capturesDir: string
}): Promise<Destination> {
  if (opts.out === undefined) return { kind: 'auto', dir: opts.capturesDir, create: true }
  const path = resolve(opts.cwd, opts.out)
  const existing = await statOrNull(path)
  if (existing?.isDirectory()) return { kind: 'auto', dir: path, create: false }
  if (!existing && (opts.out.endsWith('/') || opts.out.endsWith(sep))) throw notFound(path)
  if (!PNG.test(path)) {
    throw new OvdError(
      'INVALID_PATH',
      '--out must be a .png file or a folder',
      'Give a path ending in .png, or an existing folder'
    )
  }
  if (existing) {
    if (!opts.force) throw fileExists(path)
    return { kind: 'file', path, force: true }
  }
  const parent = await statOrNull(dirname(path))
  if (!parent?.isDirectory()) throw notFound(dirname(path))
  return { kind: 'file', path, force: opts.force }
}

// The hidden temp file the image is written to first, next to where it ends up, so a reader
// of the folder never sees a partial `.png`: `.<final name>.<8 hex>.part`.
export async function tempFor(dest: Destination, base: string, hex: string): Promise<string> {
  if (dest.kind === 'file') return join(dirname(dest.path), `.${basename(dest.path)}.${hex}.part`)
  if (dest.create) {
    await mkdir(dest.dir, { recursive: true }).catch((error: unknown) => {
      throw saveError(dest.dir, error)
    })
  }
  return join(dest.dir, `.${captureName(base, 1)}.${hex}.part`)
}

// Gives the finished temp file its final name and returns that path. A new name is reserved
// with `link` (or, where hard links aren't allowed, an exclusive copy), so two takes in the same
// second never overwrite each other: a taken default name moves on to the next suffix, a taken
// `--out` file is EXPORT_FILE_EXISTS. Only `force` replaces, with `rename`. The caller removes
// the temp file afterwards.
export async function commitFile(
  temp: string,
  dest: Destination,
  base: string,
  fs: SaveFs = nodeSaveFs
): Promise<string> {
  if (dest.kind === 'file') {
    if (dest.force) {
      await fs.rename(temp, dest.path).catch((error: unknown) => {
        throw saveError(dest.path, error)
      })
      return dest.path
    }
    if (!(await reserve(temp, dest.path, fs))) throw fileExists(dest.path)
    return dest.path
  }
  for (let n = 1; n <= MAX_SUFFIX; n++) {
    const path = join(dest.dir, captureName(base, n))
    if (await reserve(temp, path, fs)) return path
  }
  throw saveError(dest.dir, new Error(`${MAX_SUFFIX} files named ${base} already exist`))
}

// True once `path` is this temp file's; false when the name is taken.
async function reserve(temp: string, path: string, fs: SaveFs): Promise<boolean> {
  try {
    await fs.link(temp, path)
    return true
  } catch (error) {
    if (isErrno(error, 'EEXIST')) return false
  }
  // EPERM, ENOTSUP, EXDEV…: a folder without hard links still gets an exclusive copy.
  try {
    await fs.copyFile(temp, path, constants.COPYFILE_EXCL)
    return true
  } catch (error) {
    if (isErrno(error, 'EEXIST')) return false
    throw saveError(path, error)
  }
}

export async function removeQuietly(path: string): Promise<void> {
  await unlink(path).catch(() => undefined)
}

async function statOrNull(path: string) {
  try {
    return await stat(path)
  } catch {
    return null
  }
}

function notFound(path: string): OvdError {
  return new OvdError(
    'PATH_NOT_FOUND',
    `${path} doesn’t exist`,
    'Create the folder first, or choose another path'
  )
}

function fileExists(path: string): OvdError {
  return new OvdError(
    'EXPORT_FILE_EXISTS',
    `${path} already exists`,
    'Pass --force to replace it, or choose another file'
  )
}

export function saveError(path: string, error: unknown): OvdError {
  if (error instanceof OvdError) return error
  const code = error instanceof Error && 'code' in error ? String(error.code) : undefined
  const reason = code ?? (error instanceof Error ? error.message : String(error))
  return new OvdError(
    'SCREENSHOT_FAILED',
    `Couldn’t save the screenshot to ${path} (${reason})`,
    'Check that you can write to the folder and that the disk isn’t full'
  )
}
