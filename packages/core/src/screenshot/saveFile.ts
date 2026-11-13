import { constants } from 'node:fs'
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
  stat,
  unlink
} from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { OvdError, type ErrorCode } from '../errors/ovdError.js'
import { isErrno } from './captures.js'

// What is being saved, for the file extension, the messages and the error code: screenshots
// (`.png`) and crash reports (`.acr`) share this code (Stage 5.1). `ext` has no dot.
export interface SaveKind {
  ext: string
  // As in "Couldn’t save the <noun> to …".
  noun: string
  failure: ErrorCode
}

export const PNG_KIND: SaveKind = {
  ext: 'png',
  noun: 'screenshot',
  failure: 'SCREENSHOT_FAILED'
}

const nameOf = (kind: SaveKind, base: string, n: number) =>
  `${n === 1 ? base : `${base}-${n}`}.${kind.ext}`

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

// `--out`, resolved against `cwd`: an existing folder gets a default name inside it; anything
// else must be a file with the kind's extension in an existing folder. An existing file needs
// `force`. A symbolic link is never a destination file, `force` included. A folder the user
// named that is a link (macOS `/tmp`, a linked `~/Desktop`) is resolved with realpath and used:
// they chose it. OVD's own default folders are never links (`assertRealFolder` at save time).
export async function resolveDestination(opts: {
  out: string | undefined
  force: boolean
  cwd: string
  capturesDir: string
  kind?: SaveKind
}): Promise<Destination> {
  const kind = opts.kind ?? PNG_KIND
  if (opts.out === undefined) return { kind: 'auto', dir: opts.capturesDir, create: true }
  const path = resolve(opts.cwd, opts.out)
  const linked = await lstatOrNull(path)
  if (linked?.isSymbolicLink()) {
    // A link to a folder is that folder; a link to a file, or a dangling one, is refused.
    if (!(await statOrNull(path))?.isDirectory()) throw symlinkRefused(path)
    return { kind: 'auto', dir: await realpath(path), create: false }
  }
  const existing = await statOrNull(path)
  if (existing?.isDirectory()) return { kind: 'auto', dir: path, create: false }
  if (!existing && (opts.out.endsWith('/') || opts.out.endsWith(sep))) throw notFound(path)
  if (!path.toLowerCase().endsWith(`.${kind.ext}`)) {
    throw new OvdError(
      'INVALID_PATH',
      `--out must be a .${kind.ext} file or a folder`,
      `Give a path ending in .${kind.ext}, or an existing folder`
    )
  }
  const parent = await statOrNull(dirname(path))
  if (!parent?.isDirectory()) throw notFound(dirname(path))
  const folder = (await lstatOrNull(dirname(path)))?.isSymbolicLink()
    ? await realpath(dirname(path))
    : dirname(path)
  const target = join(folder, basename(path))
  if (existing) {
    if (!opts.force) throw fileExists(target)
    return { kind: 'file', path: target, force: true }
  }
  return { kind: 'file', path: target, force: opts.force }
}

// A private staging folder (mkdtemp: 0700, exclusive) inside the destination folder, so the
// final link or rename stays on one file system. A program that writes into it (`vda pull`)
// can't be fed a planted link, and nobody else can read the file while it arrives. The caller
// calls `remove` in a `finally`.
export interface Staging {
  // Where the other program writes; inside the staging folder.
  file: string
  remove: () => Promise<void>
}

export async function stageFor(dest: Destination, kind: SaveKind = PNG_KIND): Promise<Staging> {
  const folder = dest.kind === 'file' ? dirname(dest.path) : dest.dir
  if (dest.kind === 'auto' && dest.create) {
    await mkdir(folder, { recursive: true }).catch((error: unknown) => {
      throw saveError(folder, error, kind)
    })
  }
  await assertRealFolder(folder, kind)
  let staging: string
  try {
    staging = await mkdtemp(join(folder, '.ovd-pull-'))
  } catch (error) {
    throw saveError(folder, error, kind)
  }
  return {
    file: join(staging, `pull.${kind.ext}.part`),
    remove: () => rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}

// The hidden temp file the image is written to first, next to where it ends up, so a reader
// of the folder never sees a partial `.png`: `.<final name>.<8 hex>.part`.
export async function tempFor(
  dest: Destination,
  base: string,
  hex: string,
  kind: SaveKind = PNG_KIND
): Promise<string> {
  if (dest.kind === 'file') {
    await assertRealFolder(dirname(dest.path), kind)
    return join(dirname(dest.path), `.${basename(dest.path)}.${hex}.part`)
  }
  if (dest.create) {
    await mkdir(dest.dir, { recursive: true }).catch((error: unknown) => {
      throw saveError(dest.dir, error, kind)
    })
  }
  await assertRealFolder(dest.dir, kind)
  return join(dest.dir, `.${nameOf(kind, base, 1)}.${hex}.part`)
}

// Creates the temp file exclusively (it must not exist, and a symbolic link in its place is
// refused, not followed) with mode 0600, and writes `bytes` to it.
export async function writePart(
  temp: string,
  bytes: Uint8Array,
  kind: SaveKind = PNG_KIND
): Promise<void> {
  try {
    const handle = await open(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    )
    try {
      await handle.writeFile(bytes)
    } finally {
      await handle.close()
    }
  } catch (error) {
    throw saveError(temp, error, kind)
  }
}

// Reads a temp file another program (`vda pull`) wrote: a symbolic link in its place, anything
// but a regular file with one link, or more than `maxBytes` is refused before its bytes are
// read. The file is made 0600 (the SDK writes it with the user's umask). null: it isn't there.
export async function readPart(
  temp: string,
  kind: SaveKind = PNG_KIND,
  maxBytes = Number.POSITIVE_INFINITY
): Promise<Buffer | null> {
  let handle
  try {
    handle = await open(temp, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return null
    throw saveError(temp, error, kind)
  }
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.nlink !== 1) throw linkRefused(temp, kind)
    if (info.size > maxBytes) throw tooBig(temp, kind, maxBytes)
    await handle.chmod(0o600)
    return await handle.readFile()
  } catch (error) {
    throw saveError(temp, error, kind)
  } finally {
    await handle.close()
  }
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
  fs: SaveFs = nodeSaveFs,
  kind: SaveKind = PNG_KIND
): Promise<string> {
  // Checked again here, not only when the temp name was chosen: the folder, the temp file and
  // the destination may have been swapped meanwhile.
  const info = await lstatOrNull(temp)
  if (!info?.isFile() || info.nlink !== 1) throw linkRefused(temp, kind)
  await assertRealFolder(dest.kind === 'file' ? dirname(dest.path) : dest.dir, kind)
  if (dest.kind === 'file') {
    if ((await lstatOrNull(dest.path))?.isSymbolicLink()) throw symlinkRefused(dest.path)
    if (dest.force) {
      // `rename` replaces the directory entry itself, never what a link there points to.
      await fs.rename(temp, dest.path).catch((error: unknown) => {
        throw saveError(dest.path, error, kind)
      })
      return dest.path
    }
    if (!(await reserve(temp, dest.path, fs, kind))) throw fileExists(dest.path)
    return dest.path
  }
  for (let n = 1; n <= MAX_SUFFIX; n++) {
    const path = join(dest.dir, nameOf(kind, base, n))
    if (await reserve(temp, path, fs, kind)) return path
  }
  throw saveError(dest.dir, new Error(`${MAX_SUFFIX} files named ${base} already exist`), kind)
}

// True once `path` is this temp file's; false when the name is taken (a symbolic link there
// counts as taken: `link` and an exclusive copy both fail on it instead of following it).
async function reserve(temp: string, path: string, fs: SaveFs, kind: SaveKind): Promise<boolean> {
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
    throw saveError(path, error, kind)
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

async function lstatOrNull(path: string) {
  try {
    return await lstat(path)
  } catch {
    return null
  }
}

async function assertRealFolder(dir: string, kind: SaveKind): Promise<void> {
  try {
    const info = await lstat(dir)
    if (info.isSymbolicLink()) throw symlinkRefused(dir)
    if (!info.isDirectory()) throw notFound(dir)
  } catch (error) {
    if (error instanceof OvdError) throw error
    if (isErrno(error, 'ENOENT')) throw notFound(dir)
    throw saveError(dir, error, kind)
  }
}

function symlinkRefused(path: string): OvdError {
  return new OvdError(
    'INVALID_PATH',
    `${path} is a symbolic link`,
    'OVD doesn’t write through links: give the real folder or file'
  )
}

function linkRefused(path: string, kind: SaveKind): OvdError {
  return new OvdError(
    kind.failure,
    `Refusing to save the ${kind.noun}: ${path} isn’t a plain file with one link`,
    'Check the folder for other programs writing to it, then retry'
  )
}

function tooBig(path: string, kind: SaveKind, maxBytes: number): OvdError {
  return new OvdError(
    kind.failure,
    `The ${kind.noun} at ${path} is larger than ${maxBytes} bytes`,
    'Retry; if it happens again the device may be sending something else'
  )
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

export function saveError(path: string, error: unknown, kind: SaveKind = PNG_KIND): OvdError {
  if (error instanceof OvdError) return error
  const code = error instanceof Error && 'code' in error ? String(error.code) : undefined
  const reason = code ?? (error instanceof Error ? error.message : String(error))
  return new OvdError(
    kind.failure,
    `Couldn’t save the ${kind.noun} to ${path} (${reason})`,
    'Check that you can write to the folder and that the disk isn’t full'
  )
}
