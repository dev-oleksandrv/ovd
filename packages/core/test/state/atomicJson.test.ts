import { mkdir, mkdtemp, readdir, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { writeJsonAtomic } from '../../src/state/atomicJson.js'

describe('writeJsonAtomic', () => {
  test('creates the folder 0700 and the file 0600, and leaves no temp file', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'ovd-atomic-')), 'a', 'ovd')
    const file = join(dir, 'x.json')
    await writeJsonAtomic(file, { version: 1, list: [1, 2] })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, list: [1, 2] })
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await readdir(dir)).toEqual(['x.json'])
  })

  test('replaces an existing file whole', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ovd-atomic-'))
    const file = join(dir, 'x.json')
    await writeJsonAtomic(file, { long: 'a'.repeat(500) })
    await writeJsonAtomic(file, { short: 1 })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ short: 1 })
  })

  test('removes the temp file when the rename fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ovd-atomic-'))
    // A folder at the target: the rename of a file onto it fails.
    const file = join(dir, 'x.json')
    await mkdir(join(file, 'inner'), { recursive: true })
    await expect(writeJsonAtomic(file, { a: 1 })).rejects.toThrow()
    expect(await readdir(dir)).toEqual(['x.json'])
  })
})
