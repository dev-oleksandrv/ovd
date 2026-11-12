// @vitest-environment node
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  capturePath,
  logsExportRequest,
  logsFilter,
  optionalFlag,
  optionalSeq,
  requireFlag,
  requireText
} from '../../src/main/guards'

describe('requireText', () => {
  test('returns a non-empty string unchanged', () => {
    expect(requireText('Living room stick', 'name')).toBe('Living room stick')
  })

  test.each([
    ['an empty string', ''],
    ['a number', 42],
    ['undefined', undefined],
    ['null', null],
    ['an object', { name: 'Bedroom stick' }]
  ])('rejects %s and names the field', (_label, value) => {
    expect(() => requireText(value, 'name')).toThrow(
      new TypeError('name must be a non-empty string')
    )
  })
})

describe('optionalFlag', () => {
  test.each([
    ['undefined', undefined, false],
    ['true', true, true],
    ['false', false, false]
  ])('%s → %s', (_label, value, flag) => {
    expect(optionalFlag(value, 'force')).toBe(flag)
  })

  test.each([
    ['a string', 'true'],
    ['a number', 1],
    ['null', null],
    ['an object', { force: true }]
  ])('rejects %s and names the field', (_label, value) => {
    expect(() => optionalFlag(value, 'force')).toThrow(new TypeError('force must be a boolean'))
  })
})

describe('logsFilter', () => {
  test.each([
    ['an empty filter', {}],
    ['every key', { app: 'com.example.player', level: 'e', search: 'tick', regex: true }],
    ['system', { system: true }]
  ])('accepts %s', (_label, value) => {
    expect(logsFilter(value)).toEqual(value)
  })

  test('drops keys that are undefined', () => {
    expect(logsFilter({ app: undefined, level: 'w' })).toEqual({ level: 'w' })
  })

  test.each([
    ['null', null, 'filter must be an object'],
    ['a string', 'level=e', 'filter must be an object'],
    ['an array', [], 'filter must be an object'],
    ['a numeric level', { level: 4 }, 'filter.level must be a string'],
    ['a string regex', { regex: 'true' }, 'filter.regex must be a boolean'],
    ['an unknown key', { until: '07:30' }, 'filter.until is not a log filter']
  ])('rejects %s', (_label, value, message) => {
    expect(() => logsFilter(value)).toThrow(new TypeError(message))
  })
})

describe('optionalSeq', () => {
  test.each([
    [undefined, undefined],
    [0, 0],
    [42, 42]
  ])('%s → %s', (value, seq) => {
    expect(optionalSeq(value)).toBe(seq)
  })

  test.each([
    ['-1', -1],
    ['1.5', 1.5],
    ['a string', '3'],
    ['null', null]
  ])('rejects %s', (_label, value) => {
    expect(() => optionalSeq(value)).toThrow(TypeError)
  })
})

describe('requireFlag', () => {
  test.each([true, false])('%s is returned as is', (value) => {
    expect(requireFlag(value, 'on')).toBe(value)
  })

  test.each([
    ['undefined', undefined],
    ['a string', 'true'],
    ['a number', 1],
    ['null', null]
  ])('%s is a TypeError', (_label, value) => {
    expect(() => requireFlag(value, 'on')).toThrow(new TypeError('on must be a boolean'))
  })
})

describe('logsExportRequest', () => {
  test.each([
    [{ format: 'text' }, { format: 'text' }],
    [
      { format: 'jsonl', throughSeq: 4 },
      { format: 'jsonl', throughSeq: 4 }
    ],
    [{ format: 'jsonl', throughSeq: undefined }, { format: 'jsonl' }]
  ])('%o is accepted', (value, request) => {
    expect(logsExportRequest(value)).toEqual(request)
  })

  test.each([
    ['undefined', undefined],
    ['a format alone', 'text'],
    ['an array', []],
    ['no format', {}],
    ['an unknown format', { format: 'csv' }],
    ['a bad throughSeq', { format: 'text', throughSeq: -1 }],
    ['an unknown key', { format: 'text', path: '/tmp/x' }]
  ])('rejects %s', (_label, value) => {
    expect(() => logsExportRequest(value)).toThrow(TypeError)
  })
})

describe('capturePath', () => {
  const setup = async () => {
    const root = await mkdtemp(join(tmpdir(), 'ovd-reveal-'))
    const dir = join(root, 'captures')
    await mkdir(dir)
    await mkdir(join(root, 'captures-evil'))
    await writeFile(join(dir, 'shot.png'), 'png')
    await writeFile(join(dir, 'notes.txt'), 'x')
    await writeFile(join(root, 'captures-evil', 'shot.png'), 'png')
    await writeFile(join(root, 'secret.png'), 'png')
    await symlink(join(root, 'secret.png'), join(dir, 'link.png'))
    return { root, dir }
  }

  test('a .png inside the captures folder resolves to its real path', async () => {
    const { dir } = await setup()
    expect(await capturePath(join(dir, 'shot.png'), dir, realpath)).toBe(
      await realpath(join(dir, 'shot.png'))
    )
  })

  test.each([
    ['a path out with ..', (root: string) => join(root, 'captures', '..', 'secret.png')],
    [
      'a sibling folder sharing the prefix',
      (root: string) => join(root, 'captures-evil', 'shot.png')
    ],
    ['a symlink out of the folder', (root: string) => join(root, 'captures', 'link.png')],
    ['a file that isn’t a .png', (root: string) => join(root, 'captures', 'notes.txt')],
    ['the folder itself', (root: string) => join(root, 'captures')]
  ])('refuses %s', async (_label, path) => {
    const { root, dir } = await setup()
    await expect(capturePath(path(root), dir, realpath)).rejects.toThrow(
      new TypeError('path is not a capture')
    )
  })

  test.each([[''], [42], [null]])('refuses a payload that isn’t a path: %j', async (value) => {
    await expect(capturePath(value, '/tmp', realpath)).rejects.toThrow(TypeError)
  })
})
