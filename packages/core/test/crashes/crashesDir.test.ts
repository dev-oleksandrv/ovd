import { mkdir, mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { crashesDir, ensureCrashesDir } from '../../src/crashes/crashesDir.js'

describe('crashesDir', () => {
  test('defaults to ~/ovd/crashes', () => {
    expect(crashesDir({}, '/home/dev')).toBe('/home/dev/ovd/crashes')
    expect(crashesDir({ OVD_CRASHES: '' }, '/home/dev')).toBe('/home/dev/ovd/crashes')
  })

  test('OVD_CRASHES wins, relative to home', () => {
    expect(crashesDir({ OVD_CRASHES: '/data/crashes' }, '/home/dev')).toBe('/data/crashes')
    expect(crashesDir({ OVD_CRASHES: 'bugs' }, '/home/dev')).toBe('/home/dev/bugs')
  })
})

describe('ensureCrashesDir', () => {
  test('creates the folder and its parents with mode 0700', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ovd-crashes-dir-'))
    const dir = join(root, 'ovd', 'crashes')
    await ensureCrashesDir(dir)
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
    await ensureCrashesDir(dir)
  })

  test('keeps the mode of a folder that exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ovd-crashes-dir-'))
    const dir = join(root, 'mine')
    await mkdir(dir, { mode: 0o755 })
    await ensureCrashesDir(dir)
    expect((await stat(dir)).mode & 0o777).toBe(0o755)
  })

  test('a folder that can’t be created is CRASH_PULL_FAILED', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ovd-crashes-dir-'))
    await ensureCrashesDir(join(root, 'file-parent'))
    await expect(ensureCrashesDir('/dev/null/crashes')).rejects.toMatchObject({
      code: 'CRASH_PULL_FAILED'
    })
  })
})
