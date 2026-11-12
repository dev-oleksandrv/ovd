import { mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { captureBase, captureName, capturesDir, listCaptures, slug } from '../../src/index.js'

const PNG = new URL('../../../../fixtures/0.24/vda-pull/synthetic-screenshot.png', import.meta.url)

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ovd-captures-'))
})

describe('capturesDir', () => {
  test('~/ovd/captures by default', () => {
    expect(capturesDir({}, '/home/developer')).toBe('/home/developer/ovd/captures')
  })

  test('OVD_CAPTURES when set; a relative one is under the home folder', () => {
    expect(capturesDir({ OVD_CAPTURES: '/tmp/shots' }, '/home/developer')).toBe('/tmp/shots')
    expect(capturesDir({ OVD_CAPTURES: 'shots' }, '/home/developer')).toBe('/home/developer/shots')
    expect(capturesDir({ OVD_CAPTURES: '' }, '/home/developer')).toBe(
      '/home/developer/ovd/captures'
    )
  })
})

describe('slug', () => {
  test.each([
    ['Vega Virtual Device', 'vega-virtual-device'],
    ['Fire TV Stick 4K Select', 'fire-tv-stick-4k-select'],
    ['../x', 'x'],
    ['Living room stick / 2', 'living-room-stick-2'],
    ['📺📺', 'device'],
    ['', 'device'],
    ['a'.repeat(39) + ' bb', 'a'.repeat(39)],
    ['x'.repeat(60), 'x'.repeat(40)]
  ])('%j → %j', (name, expected) => {
    expect(slug(name)).toBe(expected)
  })
})

describe('captureBase and captureName', () => {
  test('device slug, local date and time; -2, -3 after the first', () => {
    const base = captureBase('Vega Virtual Device', new Date(2026, 10, 12, 2, 11, 5))
    expect(base).toBe('vega-virtual-device-20261112-021105')
    expect([1, 2, 3].map((n) => captureName(base, n))).toEqual([
      'vega-virtual-device-20261112-021105.png',
      'vega-virtual-device-20261112-021105-2.png',
      'vega-virtual-device-20261112-021105-3.png'
    ])
  })
})

describe('listCaptures', () => {
  const put = async (name: string, mtime: number, bytes?: Uint8Array) => {
    await writeFile(join(dir, name), bytes ?? (await readFile(PNG)))
    await utimes(join(dir, name), mtime, mtime)
  }

  test('a missing folder is an empty list', async () => {
    expect(await listCaptures(join(dir, 'nope'), 100)).toEqual([])
  })

  test('valid PNGs only, newest first, with size and mtime', async () => {
    await put('old.png', 1_700_000_000)
    await put('new.PNG', 1_800_000_000)
    // Not listed: a temp file, a hidden file, an empty and a text .png, another extension.
    await put('.old.png.0123abcd.part', 1_900_000_000)
    await put('.hidden.png', 1_900_000_000)
    await put('empty.png', 1_900_000_000, new Uint8Array())
    await put('text.png', 1_900_000_000, new Uint8Array(Buffer.from('not a png at all, really')))
    await put('notes.txt', 1_900_000_000)
    await mkdir(join(dir, 'folder.png'))

    expect(await listCaptures(dir, 100)).toEqual([
      {
        name: 'new.PNG',
        path: join(dir, 'new.PNG'),
        bytes: 9780,
        width: 1920,
        height: 1080,
        takenAt: new Date(1_800_000_000_000).toISOString()
      },
      {
        name: 'old.png',
        path: join(dir, 'old.png'),
        bytes: 9780,
        width: 1920,
        height: 1080,
        takenAt: new Date(1_700_000_000_000).toISOString()
      }
    ])
  })

  test('at most `limit`', async () => {
    for (let i = 0; i < 5; i++) await put(`shot-${i}.png`, 1_700_000_000 + i)
    expect((await listCaptures(dir, 2)).map((c) => c.name)).toEqual(['shot-4.png', 'shot-3.png'])
  })
})
