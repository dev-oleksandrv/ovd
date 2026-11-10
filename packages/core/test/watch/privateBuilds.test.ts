import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { privateBuilds } from '../../src/watch/privateBuilds.js'

let project: string

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'ovd-private-'))
})
afterEach(async () => {
  await rm(project, { recursive: true, force: true })
})

async function file(path: string, at?: Date): Promise<string> {
  const full = join(project, path)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, 'fake-vpkg')
  if (at) await utimes(full, at, at)
  return full
}

// Where `react-native build-vega` packs (ARCHITECTURE §8).
const PACKED =
  'build/private/kepler/@amazon-devices/player/undefined/vega/aarch64/Debug/@amazon-devices/player_aarch64.vpkg'

test('the packages under build/private/, with their architecture and type', async () => {
  const at = new Date('2026-11-10T09:05:00.000Z')
  const packed = await file(PACKED, at)
  const other = await file('build/private/other/player.vpkg', at)
  await file('build/private/vega/aarch64/Debug/manifest.toml')
  await file('build/aarch64-debug/player_aarch64.vpkg')

  const found = await privateBuilds(project)

  expect(found.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
    {
      path: packed,
      size: 9,
      modifiedAt: '2026-11-10T09:05:00.000Z',
      arch: 'aarch64',
      buildType: 'debug'
    },
    { path: other, size: 9, modifiedAt: '2026-11-10T09:05:00.000Z' }
  ])
})

test('no build/private/: none', async () => {
  expect(await privateBuilds(project)).toEqual([])
})
