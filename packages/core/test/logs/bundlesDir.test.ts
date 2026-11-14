import { mkdir, mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { bundlesDir, ensureBundlesDir } from '../../src/logs/bundlesDir.js'

describe('bundlesDir', () => {
  test('defaults to ~/ovd/bundles', () => {
    expect(bundlesDir({}, '/home/dev')).toBe('/home/dev/ovd/bundles')
    expect(bundlesDir({ OVD_BUNDLES: '' }, '/home/dev')).toBe('/home/dev/ovd/bundles')
  })

  test('OVD_BUNDLES wins, relative to home', () => {
    expect(bundlesDir({ OVD_BUNDLES: '/data/bundles' }, '/home/dev')).toBe('/data/bundles')
    expect(bundlesDir({ OVD_BUNDLES: 'bugs' }, '/home/dev')).toBe('/home/dev/bugs')
  })
})

describe('ensureBundlesDir', () => {
  test('creates the folder and its parents with mode 0700', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ovd-bundles-dir-'))
    const dir = join(root, 'ovd', 'bundles')
    await ensureBundlesDir(dir)
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
    await ensureBundlesDir(dir)
  })

  test('keeps the mode of a folder that exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ovd-bundles-dir-'))
    const dir = join(root, 'mine')
    await mkdir(dir, { mode: 0o755 })
    await ensureBundlesDir(dir)
    expect((await stat(dir)).mode & 0o777).toBe(0o755)
  })

  test('a folder that can’t be created is LOG_BUNDLE_FAILED', async () => {
    await expect(ensureBundlesDir('/dev/null/bundles')).rejects.toMatchObject({
      code: 'LOG_BUNDLE_FAILED'
    })
  })
})
