import { mkdtemp, readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { createStateStore, emptyState, type HostState } from '../../src/index.js'

let home: string

beforeEach(async () => {
  home = join(await mkdtemp(join(tmpdir(), 'ovd-state-')), 'ovd')
})

async function seed(content: string): Promise<void> {
  await mkdir(home, { recursive: true })
  await writeFile(join(home, 'state.json'), content)
}

describe('createStateStore', () => {
  test('a missing file reads as the empty state without creating the directory', async () => {
    expect(await createStateStore(home).read()).toEqual({ state: emptyState, recovered: false })
    await expect(readdir(home)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('update creates the directory and persists the change', async () => {
    const store = createStateStore(home)
    const next = await store.update((s) => ({ ...s, target: 'VirtualDevice' }))
    expect(next.target).toBe('VirtualDevice')
    expect((await createStateStore(home).read()).state.target).toBe('VirtualDevice')
  })

  test('a corrupt file is backed up and replaced by the empty state', async () => {
    await seed('{not json')
    expect(await createStateStore(home).read()).toEqual({ state: emptyState, recovered: true })
    expect(await readFile(join(home, 'state.json.bak'), 'utf8')).toBe('{not json')
  })

  test('a file from another state version is treated as corrupt', async () => {
    await seed('{"version":2,"names":{},"saved":[]}')
    expect((await createStateStore(home).read()).recovered).toBe(true)
  })

  test('an invalid update is rejected and leaves the file intact', async () => {
    const store = createStateStore(home)
    await store.update((s) => ({ ...s, target: 'VirtualDevice' }))
    const invalid = (s: HostState) => ({ ...s, saved: [{ id: 1 }] }) as unknown as HostState
    await expect(store.update(invalid)).rejects.toThrow()
    expect((await store.read()).state.target).toBe('VirtualDevice')
  })

  test('two readers recovering the same corrupt file both get the empty state', async () => {
    await seed('{not json')
    const results = await Promise.all([
      createStateStore(home).read(),
      createStateStore(home).read()
    ])
    expect(results).toEqual([
      { state: emptyState, recovered: true },
      { state: emptyState, recovered: true }
    ])
  })

  test('a mutating update callback cannot change the shared empty state', async () => {
    await createStateStore(home).update((s) => {
      s.names['G070000000000001'] = 'Den'
      return s
    })
    expect(emptyState).toEqual({ version: 1, names: {}, saved: [] })
  })

  test('no temporary files remain after an update', async () => {
    await createStateStore(home).update((s) => ({ ...s, names: { G070000000000001: 'Den' } }))
    expect(await readdir(home)).toEqual(['state.json'])
  })
})
