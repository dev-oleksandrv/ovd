import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { commitFile, resolveDestination, type SaveFs } from '../../src/index.js'

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
