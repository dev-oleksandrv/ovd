import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  createSavedFilters,
  createStateStore,
  MAX_SAVED_FILTERS,
  type SavedFilters
} from '../../src/index.js'

let home: string
let filters: SavedFilters
const file = () => join(home, 'log-filters.json')

beforeEach(async () => {
  home = join(await mkdtemp(join(tmpdir(), 'ovd-filters-')), 'ovd')
  filters = createSavedFilters({ home, now: () => new Date('2026-11-14T10:00:00Z') })
})

const seed = async (body: unknown) => {
  await mkdir(home, { recursive: true })
  await writeFile(file(), typeof body === 'string' ? body : JSON.stringify(body))
}

describe('saved filters', () => {
  test('a missing file is an empty list and creates nothing', async () => {
    expect(await filters.list()).toEqual([])
    await expect(readdir(home)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('save and list round trip, across a new store (another process)', async () => {
    const input = {
      level: 'warn',
      search: 'timeout',
      pid: [12, '34'],
      processRules: [{ identity: 'com.example.player', rate: 5 }]
    }
    expect(await filters.save('slow-net', input)).toEqual({ name: 'slow-net', filter: input })
    const again = createSavedFilters({ home })
    expect(await again.list()).toEqual([{ name: 'slow-net', filter: input, valid: true }])
    expect(JSON.parse(await readFile(file(), 'utf8'))).toEqual({
      version: 1,
      filters: [{ name: 'slow-net', filter: input }]
    })
  })

  test('the folder is 0700, the file 0600, and no temp file is left', async () => {
    await filters.save('a', { level: 'error' })
    expect((await stat(home)).mode & 0o777).toBe(0o700)
    expect((await stat(file())).mode & 0o777).toBe(0o600)
    expect(await readdir(home)).toEqual(['log-filters.json'])
  })

  test('unset fields are not stored', async () => {
    await filters.save('a', { level: 'error', search: undefined })
    expect(JSON.parse(await readFile(file(), 'utf8')).filters[0].filter).toEqual({ level: 'error' })
  })

  test.each([
    ['empty', ''],
    ['upper case', 'Slow'],
    ['space', 'a b'],
    ['leading hyphen', '-a'],
    ['slash', 'a/b'],
    ['dots', '../x'],
    ['too long', 'a'.repeat(41)],
    ['reserved: all', 'all'],
    ['reserved: app-errors', 'app-errors'],
    ['reserved: network', 'network'],
    ['reserved: lifecycle', 'lifecycle'],
    ['a control character', 'a\u001b[2Jb']
  ])('a bad name (%s) is INVALID_LOG_FILTER_NAME', async (_label, name) => {
    await expect(filters.save(name, {})).rejects.toMatchObject({
      code: 'INVALID_LOG_FILTER_NAME'
    })
    await expect(readdir(home)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('40 characters and digits are fine', async () => {
    await filters.save(`1${'a'.repeat(39)}`, {})
    expect((await filters.list())[0]?.name).toHaveLength(40)
  })

  test('an existing name needs force, and force replaces it in place', async () => {
    await filters.save('a', { level: 'error' })
    await filters.save('b', {})
    await expect(filters.save('a', { level: 'info' })).rejects.toMatchObject({
      code: 'LOG_FILTER_EXISTS'
    })
    await filters.save('a', { level: 'info' }, { force: true })
    expect((await filters.list()).map((item) => [item.name, item.filter])).toEqual([
      ['a', { level: 'info' }],
      ['b', {}]
    ])
  })

  test('the store holds at most 50, force or not, and a replace still works at 50', async () => {
    for (let i = 0; i < MAX_SAVED_FILTERS; i++) await filters.save(`f${i}`, {})
    await expect(filters.save('one-more', {})).rejects.toMatchObject({ code: 'LOG_FILTER_EXISTS' })
    await expect(filters.save('one-more', {}, { force: true })).rejects.toMatchObject({
      code: 'LOG_FILTER_EXISTS'
    })
    await filters.save('f3', { level: 'error' }, { force: true })
    expect(await filters.list()).toHaveLength(MAX_SAVED_FILTERS)
  })

  test.each([
    ['since', { since: '10m' }],
    ['until', { until: '5m' }],
    ['boot', { boot: ['current'] }]
  ])('%s is refused in a saved filter', async (_key, input) => {
    await expect(filters.save('a', input)).rejects.toMatchObject({ code: 'INVALID_LOG_FILTER' })
  })

  test.each([
    ['a bad level', { level: 'loud' }],
    ['a regex bomb', { search: '(a+)+$', regex: true }],
    ['a backreference', { search: '(a)\\1', regex: true }],
    ['a bad pid', { pid: ['x'] }],
    ['a bad facility', { facility: ['nope'] }],
    ['a rule that sets nothing', { processRules: [{ identity: 'x' }] }],
    ['an unknown field', { nope: 1 }],
    ['a wrong type', { system: 'yes' }]
  ])('%s is INVALID_LOG_FILTER at save, before anything is written', async (_label, input) => {
    await expect(filters.save('a', input as never)).rejects.toMatchObject({
      code: 'INVALID_LOG_FILTER'
    })
    await expect(readdir(home)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('remove deletes one, and an unknown name is UNKNOWN_LOG_PRESET', async () => {
    await filters.save('a', {})
    await filters.save('b', {})
    expect(await filters.remove('a')).toEqual({ name: 'a' })
    expect((await filters.list()).map((item) => item.name)).toEqual(['b'])
    await expect(filters.remove('a')).rejects.toMatchObject({ code: 'UNKNOWN_LOG_PRESET' })
  })

  test('last writer wins: two stores saving from the same start keep the last file', async () => {
    const other = createSavedFilters({ home })
    await filters.save('a', { level: 'error' })
    await other.save('b', { level: 'info' })
    expect((await filters.list()).map((item) => item.name)).toEqual(['a', 'b'])
    // A writer that read before the other one wrote replaces the file with its own view.
    await seed({ version: 1, filters: [{ name: 'c', filter: {} }] })
    expect((await other.list()).map((item) => item.name)).toEqual(['c'])
  })

  test('state.json is untouched', async () => {
    await createStateStore(home).update((s) => ({ ...s, target: 'VirtualDevice' }))
    await filters.save('a', {})
    expect((await createStateStore(home).read()).state.target).toBe('VirtualDevice')
  })
})

describe('what is read back is untrusted', () => {
  test('an invalid entry is listed valid: false with its error, and can be removed', async () => {
    await seed({
      version: 1,
      filters: [
        { name: 'good', filter: { level: 'error' } },
        { name: 'newer', filter: { level: 'error', someFutureField: 1 } },
        { name: 'bad-level', filter: { level: 'loud' } },
        { name: 'since', filter: { since: '1h' } },
        { name: 'not-object', filter: 'oops' }
      ]
    })
    const items = await filters.list()
    expect(items.map((item) => [item.name, item.valid])).toEqual([
      ['good', true],
      ['newer', false],
      ['bad-level', false],
      ['since', false],
      ['not-object', false]
    ])
    for (const item of items.slice(1)) {
      expect(item).toMatchObject({ filter: {}, error: { code: 'INVALID_LOG_FILTER' } })
    }
    await filters.remove('newer')
    expect((await filters.list()).map((item) => item.name)).not.toContain('newer')
  })

  test('a regex bomb on disk is listed valid: false and can’t be applied', async () => {
    await seed({
      version: 1,
      filters: [{ name: 'bomb', filter: { search: '(a+)+$', regex: true } }]
    })
    const [item] = await filters.list()
    expect(item).toMatchObject({
      name: 'bomb',
      valid: false,
      error: { code: 'INVALID_LOG_FILTER' }
    })
    await expect(filters.resolve('bomb')).rejects.toMatchObject({ code: 'INVALID_LOG_FILTER' })
    expect(await filters.valid()).toEqual([])
  })

  test('saving keeps the other entries, invalid ones included', async () => {
    await seed({ version: 1, filters: [{ name: 'future', filter: { fancy: true } }] })
    await filters.save('a', {})
    const stored = JSON.parse(await readFile(file(), 'utf8')) as { filters: { name: string }[] }
    expect(stored.filters.map((entry) => entry.name)).toEqual(['future', 'a'])
  })

  test.each([
    ['not JSON', '{nope'],
    ['an array', '[]'],
    ['another version', '{"version":2,"filters":[]}'],
    ['an entry without a name', '{"version":1,"filters":[{"filter":{}}]}'],
    ['a name that is not text', '{"version":1,"filters":[{"name":7,"filter":{}}]}']
  ])('%s is LOG_FILTERS_UNREADABLE, and the file is left alone', async (_label, body) => {
    await seed(body)
    await expect(filters.list()).rejects.toMatchObject({ code: 'LOG_FILTERS_UNREADABLE' })
    await expect(filters.save('a', {})).rejects.toMatchObject({ code: 'LOG_FILTERS_UNREADABLE' })
    await expect(filters.remove('a')).rejects.toMatchObject({ code: 'LOG_FILTERS_UNREADABLE' })
    expect(await readFile(file(), 'utf8')).toBe(body)
    expect(await readdir(home)).toEqual(['log-filters.json'])
  })

  test('a file over 1 MiB, a folder and a symlink are LOG_FILTERS_UNREADABLE', async () => {
    await seed(`{"version":1,"filters":[],"pad":"${'a'.repeat(1024 * 1024)}"}`)
    await expect(filters.list()).rejects.toMatchObject({ code: 'LOG_FILTERS_UNREADABLE' })
    const elsewhere = join(home, 'elsewhere.json')
    await writeFile(elsewhere, '{"version":1,"filters":[]}')
    const linked = createSavedFilters({ home: join(home, 'linked') })
    await mkdir(join(home, 'linked'))
    await symlink(elsewhere, join(home, 'linked', 'log-filters.json'))
    await expect(linked.list()).rejects.toMatchObject({ code: 'LOG_FILTERS_UNREADABLE' })
  })

  test('an unreadable file (no permission) is LOG_FILTERS_UNREADABLE', async () => {
    await seed({ version: 1, filters: [] })
    await chmod(file(), 0o000)
    try {
      if (process.getuid?.() === 0) return
      await expect(filters.list()).rejects.toMatchObject({ code: 'LOG_FILTERS_UNREADABLE' })
    } finally {
      await chmod(file(), 0o600)
    }
  })
})

describe('resolve (--preset)', () => {
  test('a built-in key resolves without the file, with overrides over it', async () => {
    await seed('{nope')
    expect(await filters.resolve('app-errors', { level: 'warn' })).toEqual({
      level: 'warn',
      appsOnly: true
    })
  })

  test('a saved name resolves, with overrides replacing its fields', async () => {
    await filters.save('mine', { level: 'error', tag: ['net'] })
    expect(await filters.resolve('mine', { tag: ['db'] })).toEqual({ level: 'error', tag: ['db'] })
  })

  test('an unknown name is UNKNOWN_LOG_PRESET and lists what exists', async () => {
    await filters.save('mine', {})
    await expect(filters.resolve('nope')).rejects.toMatchObject({
      code: 'UNKNOWN_LOG_PRESET',
      hint: expect.stringContaining('mine')
    })
  })

  test('the stored filter is not changed by a resolved copy', async () => {
    await filters.save('mine', { tag: ['net'] })
    const first = await filters.resolve('mine')
    first.tag?.push('x')
    expect((await filters.resolve('mine')).tag).toEqual(['net'])
  })
})
