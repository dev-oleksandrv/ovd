import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  commitFile,
  readPart,
  resolveDestination,
  stageFor,
  tempFor,
  writePart,
  type SaveFs,
  type SaveKind
} from '../../src/index.js'

const ACR: SaveKind = { ext: 'acr', noun: 'crash report', failure: 'CRASH_PULL_FAILED' }

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ovd-save-'))
})

const resolveOut = (out: string | undefined, force = false) =>
  resolveDestination({ out, force, cwd: dir, capturesDir: join(dir, 'captures') })

describe('resolveDestination', () => {
  test('no --out: a new name in the captures folder, created on save', async () => {
    expect(await resolveOut(undefined)).toEqual({
      kind: 'auto',
      dir: join(dir, 'captures'),
      create: true
    })
  })

  test('an existing folder, relative to cwd: a new name inside it', async () => {
    await mkdir(join(dir, 'shots'))
    expect(await resolveOut('shots')).toEqual({
      kind: 'auto',
      dir: join(dir, 'shots'),
      create: false
    })
    expect(await resolveOut('shots/')).toEqual({
      kind: 'auto',
      dir: join(dir, 'shots'),
      create: false
    })
  })

  test('a new .png file in an existing folder, as an absolute path', async () => {
    expect(await resolveOut('shot.PNG')).toEqual({
      kind: 'file',
      path: join(dir, 'shot.PNG'),
      force: false
    })
  })

  test('an existing file needs --force', async () => {
    await writeFile(join(dir, 'shot.png'), 'x')
    await expect(resolveOut('shot.png')).rejects.toMatchObject({ code: 'EXPORT_FILE_EXISTS' })
    expect(await resolveOut('shot.png', true)).toEqual({
      kind: 'file',
      path: join(dir, 'shot.png'),
      force: true
    })
  })

  test.each([
    ['shot.jpg', 'INVALID_PATH'],
    ['shot', 'INVALID_PATH'],
    ['missing/', 'PATH_NOT_FOUND'],
    ['missing/shot.png', 'PATH_NOT_FOUND']
  ])('%s is %s', async (out, code) => {
    await expect(resolveOut(out)).rejects.toMatchObject({ code })
  })

  test('an existing file that isn’t .png is INVALID_PATH even with --force', async () => {
    await writeFile(join(dir, 'notes.txt'), 'x')
    await expect(resolveOut('notes.txt', true)).rejects.toMatchObject({
      code: 'INVALID_PATH',
      message: '--out must be a .png file or a folder'
    })
  })
})

describe('commitFile', () => {
  const temp = async (text = 'png') => {
    const path = join(dir, `.t.${Math.random().toString(16).slice(2)}.part`)
    await writeFile(path, text)
    return path
  }
  const auto = () => ({ kind: 'auto' as const, dir, create: false })

  test('a taken default name moves on to -2, -3', async () => {
    const paths = []
    for (let i = 0; i < 3; i++) paths.push(await commitFile(await temp(`n${i}`), auto(), 'shot'))
    expect(paths).toEqual([join(dir, 'shot.png'), join(dir, 'shot-2.png'), join(dir, 'shot-3.png')])
    expect(await readFile(join(dir, 'shot-3.png'), 'utf8')).toBe('n2')
  })

  test('two concurrent commits get two names', async () => {
    const [a, b] = await Promise.all([
      commitFile(await temp('a'), auto(), 'shot'),
      commitFile(await temp('b'), auto(), 'shot')
    ])
    expect(new Set([a, b])).toEqual(new Set([join(dir, 'shot.png'), join(dir, 'shot-2.png')]))
  })

  test('an --out file taken meanwhile is EXPORT_FILE_EXISTS and left as it was', async () => {
    const path = join(dir, 'out.png')
    await writeFile(path, 'theirs')
    await expect(
      commitFile(await temp(), { kind: 'file', path, force: false }, 'shot')
    ).rejects.toMatchObject({ code: 'EXPORT_FILE_EXISTS' })
    expect(await readFile(path, 'utf8')).toBe('theirs')
  })

  test('--force replaces with rename', async () => {
    const path = join(dir, 'out.png')
    await writeFile(path, 'old')
    const from = await temp('new')
    expect(await commitFile(from, { kind: 'file', path, force: true }, 'shot')).toBe(path)
    expect(await readFile(path, 'utf8')).toBe('new')
  })

  test('without hard links (EPERM) an exclusive copy reserves the name', async () => {
    const noLinks: SaveFs = {
      link: () => Promise.reject(Object.assign(new Error('nope'), { code: 'EPERM' })),
      copyFile,
      rename
    }
    await writeFile(join(dir, 'shot.png'), 'theirs')
    const path = await commitFile(await temp('mine'), auto(), 'shot', noLinks)
    expect(path).toBe(join(dir, 'shot-2.png'))
    expect(await readFile(join(dir, 'shot.png'), 'utf8')).toBe('theirs')
    expect(await readFile(path, 'utf8')).toBe('mine')
  })

  test('a folder it can’t write to is SCREENSHOT_FAILED', async () => {
    const broken: SaveFs = {
      link: () => Promise.reject(Object.assign(new Error('nope'), { code: 'EACCES' })),
      copyFile: () => Promise.reject(Object.assign(new Error('nope'), { code: 'EACCES' })),
      rename
    }
    await expect(commitFile(await temp(), auto(), 'shot', broken)).rejects.toMatchObject({
      code: 'SCREENSHOT_FAILED',
      message: `Couldn’t save the screenshot to ${join(dir, 'shot.png')} (EACCES)`
    })
    expect((await readdir(dir)).filter((n) => n.endsWith('.png'))).toEqual([])
  })
})

describe('a caller-given kind', () => {
  const resolveAcr = (out: string | undefined, force = false) =>
    resolveDestination({ out, force, cwd: dir, capturesDir: join(dir, 'crashes'), kind: ACR })

  test('--out must carry the extension, named in the message', async () => {
    expect(await resolveAcr('r.ACR')).toEqual({
      kind: 'file',
      path: join(dir, 'r.ACR'),
      force: false
    })
    await expect(resolveAcr('r.png')).rejects.toMatchObject({
      code: 'INVALID_PATH',
      message: '--out must be a .acr file or a folder'
    })
  })

  test('default names carry the extension and move on to -2', async () => {
    const auto = { kind: 'auto' as const, dir, create: false }
    const make = async (text: string) => {
      const part = join(dir, `.p.${Math.random().toString(16).slice(2)}.part`)
      await writeFile(part, text)
      return part
    }
    expect(await commitFile(await make('a'), auto, 'pkg-1-2', undefined, ACR)).toBe(
      join(dir, 'pkg-1-2.acr')
    )
    expect(await commitFile(await make('b'), auto, 'pkg-1-2', undefined, ACR)).toBe(
      join(dir, 'pkg-1-2-2.acr')
    )
    expect(await tempFor(auto, 'pkg-1-2', 'abcd1234', ACR)).toBe(
      join(dir, '.pkg-1-2.acr.abcd1234.part')
    )
  })

  test('failures carry the kind’s code and noun', async () => {
    const broken: SaveFs = {
      link: () => Promise.reject(Object.assign(new Error('nope'), { code: 'EACCES' })),
      copyFile: () => Promise.reject(Object.assign(new Error('nope'), { code: 'EACCES' })),
      rename
    }
    const part = join(dir, '.p.part')
    await writeFile(part, 'x')
    await expect(
      commitFile(part, { kind: 'auto', dir, create: false }, 'pkg', broken, ACR)
    ).rejects.toMatchObject({
      code: 'CRASH_PULL_FAILED',
      message: `Couldn’t save the crash report to ${join(dir, 'pkg.acr')} (EACCES)`
    })
  })
})

describe('link hardening', () => {
  const auto = () => ({ kind: 'auto' as const, dir, create: false })

  test('the temp file is created 0600, exclusively', async () => {
    const part = join(dir, '.t.part')
    await writePart(part, new Uint8Array([1, 2, 3]))
    expect((await lstat(part)).mode & 0o777).toBe(0o600)
    await expect(writePart(part, new Uint8Array([9]))).rejects.toMatchObject({
      code: 'SCREENSHOT_FAILED'
    })
    expect([...(await readFile(part))]).toEqual([1, 2, 3])
  })

  test('a symlink in the temp file’s place is not written through', async () => {
    const victim = join(dir, 'victim')
    await writeFile(victim, 'precious')
    const part = join(dir, '.t.part')
    await symlink(victim, part)
    await expect(writePart(part, new Uint8Array([1]), ACR)).rejects.toMatchObject({
      code: 'CRASH_PULL_FAILED'
    })
    expect(await readFile(victim, 'utf8')).toBe('precious')
  })

  test('readPart refuses a symlink and returns null for a missing file', async () => {
    const victim = join(dir, 'victim')
    await writeFile(victim, 'precious')
    await symlink(victim, join(dir, '.t.part'))
    await expect(readPart(join(dir, '.t.part'), ACR)).rejects.toMatchObject({
      code: 'CRASH_PULL_FAILED'
    })
    expect(await readPart(join(dir, 'none'), ACR)).toBeNull()
  })

  test('readPart refuses a multiply-linked file and one over the cap, and makes the file 0600', async () => {
    const part = join(dir, '.t.part')
    await writeFile(part, 'abcdef', { mode: 0o644 })
    await expect(readPart(part, ACR, 5)).rejects.toMatchObject({ code: 'CRASH_PULL_FAILED' })
    expect((await readPart(part, ACR, 6))?.toString()).toBe('abcdef')
    expect((await lstat(part)).mode & 0o777).toBe(0o600)
    await link(part, join(dir, 'other'))
    await expect(readPart(part, ACR)).rejects.toMatchObject({ code: 'CRASH_PULL_FAILED' })
  })

  test('a multiply-linked temp file is not published', async () => {
    const part = join(dir, '.t.part')
    await writeFile(part, 'secret')
    await link(part, join(dir, 'elsewhere'))
    await expect(commitFile(part, auto(), 'shot')).rejects.toMatchObject({
      code: 'SCREENSHOT_FAILED'
    })
    expect(await readdir(dir)).not.toContain('shot.png')
  })

  test('a symlink as the temp file is not published', async () => {
    const victim = join(dir, 'victim')
    await writeFile(victim, 'precious')
    const part = join(dir, '.t.part')
    await symlink(victim, part)
    await expect(commitFile(part, auto(), 'shot')).rejects.toMatchObject({
      code: 'SCREENSHOT_FAILED'
    })
    expect(await readdir(dir)).not.toContain('shot.png')
  })

  test('a symlinked OVD default folder is refused at temp name and at commit', async () => {
    const real = join(dir, 'real')
    await mkdir(real)
    const linked = join(dir, 'linked')
    await symlink(real, linked)
    const dest = { kind: 'auto' as const, dir: linked, create: false }
    await expect(tempFor(dest, 'shot', 'abcd1234')).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(stageFor(dest)).rejects.toMatchObject({ code: 'INVALID_PATH' })
    const part = join(dir, '.t.part')
    await writeFile(part, 'x')
    await expect(commitFile(part, dest, 'shot')).rejects.toMatchObject({ code: 'INVALID_PATH' })
    expect(await readdir(real)).toEqual([])
  })

  test('a symlinked default folder given as the captures folder is refused when saving', async () => {
    const real = join(dir, 'real')
    await mkdir(real)
    await symlink(real, join(dir, 'captures'))
    const dest = await resolveOut(undefined)
    await expect(stageFor(dest)).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(tempFor(dest, 'shot', 'abcd1234')).rejects.toMatchObject({ code: 'INVALID_PATH' })
    expect(await readdir(real)).toEqual([])
  })

  test('--out into a symlinked folder is resolved to the real folder and accepted', async () => {
    const real = join(dir, 'real')
    await mkdir(real)
    await symlink(real, join(dir, 'linked'))
    const realDir = await realpath(real)
    expect(await resolveOut('linked')).toEqual({ kind: 'auto', dir: realDir, create: false })
    expect(await resolveOut('linked/')).toEqual({ kind: 'auto', dir: realDir, create: false })
    expect(await resolveOut('linked/shot.png')).toEqual({
      kind: 'file',
      path: join(realDir, 'shot.png'),
      force: false
    })
    await writeFile(join(real, 'old.png'), 'x')
    expect(await resolveOut('linked/old.png', true)).toEqual({
      kind: 'file',
      path: join(realDir, 'old.png'),
      force: true
    })
    const staging = await stageFor(await resolveOut('linked'))
    await staging.remove()
    expect(await readdir(real)).toEqual(['old.png'])
  })

  test('--out onto a symlink to a file is refused, in a symlinked folder too', async () => {
    const real = join(dir, 'real')
    await mkdir(real)
    await writeFile(join(real, 'victim.png'), 'precious')
    await symlink(join(real, 'victim.png'), join(real, 'out.png'))
    await symlink(real, join(dir, 'linked'))
    await expect(resolveOut('linked/out.png', true)).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(resolveOut('real/out.png', true)).rejects.toMatchObject({ code: 'INVALID_PATH' })
    expect(await readFile(join(real, 'victim.png'), 'utf8')).toBe('precious')
  })

  test('stageFor makes a private 0700 folder inside the destination, removed by remove()', async () => {
    const staging = await stageFor({ kind: 'auto', dir, create: false }, ACR)
    expect(dirname(dirname(staging.file))).toBe(dir)
    expect((await lstat(dirname(staging.file))).mode & 0o777).toBe(0o700)
    await writeFile(staging.file, 'x')
    await staging.remove()
    expect(await readdir(dir)).toEqual([])
    await staging.remove()
  })

  test('stageFor for a file destination stages next to it', async () => {
    const staging = await stageFor({ kind: 'file', path: join(dir, 'a.acr'), force: false }, ACR)
    expect(dirname(dirname(staging.file))).toBe(dir)
    await staging.remove()
  })

  test('the captures folder swapped for a symlink after the temp name was chosen is refused', async () => {
    const captures = join(dir, 'captures')
    await mkdir(captures)
    const dest = { kind: 'auto' as const, dir: captures, create: false }
    const part = await tempFor(dest, 'shot', 'abcd1234')
    await writeFile(part, 'x')
    const elsewhere = join(dir, 'elsewhere')
    await mkdir(elsewhere)
    await unlink(part)
    await rename(captures, join(dir, 'moved'))
    await symlink(elsewhere, captures)
    await writeFile(join(dir, '.t.part'), 'x')
    await expect(commitFile(join(dir, '.t.part'), dest, 'shot')).rejects.toMatchObject({
      code: 'INVALID_PATH'
    })
    expect(await readdir(elsewhere)).toEqual([])
  })

  test('a symlinked --out file is refused, --force included, and its target is untouched', async () => {
    const victim = join(dir, 'victim.png')
    await writeFile(victim, 'precious')
    await symlink(victim, join(dir, 'out.png'))
    await expect(resolveOut('out.png')).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(resolveOut('out.png', true)).rejects.toMatchObject({ code: 'INVALID_PATH' })
    // A dangling link too.
    await symlink(join(dir, 'nowhere.png'), join(dir, 'dangling.png'))
    await expect(resolveOut('dangling.png', true)).rejects.toMatchObject({ code: 'INVALID_PATH' })
    expect(await readFile(victim, 'utf8')).toBe('precious')
  })

  test('--force onto a destination that became a symlink after resolving is refused at commit', async () => {
    const victim = join(dir, 'victim.png')
    await writeFile(victim, 'precious')
    const path = join(dir, 'out.png')
    await writeFile(path, 'old')
    const dest = await resolveOut('out.png', true)
    await unlink(path)
    await symlink(victim, path)
    const part = join(dir, '.t.part')
    await writeFile(part, 'new')
    await expect(commitFile(part, dest, 'shot')).rejects.toMatchObject({ code: 'INVALID_PATH' })
    expect(await readFile(victim, 'utf8')).toBe('precious')
  })

  test('a destination swapped for a symlink between the check and the rename is replaced, never followed', async () => {
    const victim = join(dir, 'victim.png')
    await writeFile(victim, 'precious')
    const path = join(dir, 'out.png')
    await writeFile(path, 'old')
    const racing: SaveFs = {
      link,
      copyFile,
      rename: async (from, to) => {
        await unlink(to)
        await symlink(victim, to)
        await rename(from, to)
      }
    }
    const part = join(dir, '.t.part')
    await writeFile(part, 'new')
    await commitFile(part, { kind: 'file', path, force: true }, 'shot', racing)
    expect(await readFile(victim, 'utf8')).toBe('precious')
    expect((await lstat(path)).isSymbolicLink()).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('new')
  })

  test('without --force, a symlink that appears at the name is taken, not followed', async () => {
    const victim = join(dir, 'victim.png')
    await writeFile(victim, 'precious')
    await symlink(victim, join(dir, 'shot.png'))
    const part = join(dir, '.t.part')
    await writeFile(part, 'new')
    expect(await commitFile(part, auto(), 'shot')).toBe(join(dir, 'shot-2.png'))
    expect(await readFile(victim, 'utf8')).toBe('precious')
  })

  test('a copy fallback does not follow a symlink at the name either', async () => {
    const victim = join(dir, 'victim.png')
    await writeFile(victim, 'precious')
    await symlink(victim, join(dir, 'shot.png'))
    const noLinks: SaveFs = {
      link: () => Promise.reject(Object.assign(new Error('nope'), { code: 'EPERM' })),
      copyFile,
      rename
    }
    const part = join(dir, '.t.part')
    await writeFile(part, 'new')
    expect(await commitFile(part, auto(), 'shot', noLinks)).toBe(join(dir, 'shot-2.png'))
    expect(await readFile(victim, 'utf8')).toBe('precious')
  })
})
