// @vitest-environment node
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FILTER_TEXT_MAX, LOG_FACILITIES, MAX_FILTER_NAME_CHARS, MAX_PROCESS_RATE } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import {
  FILTER_TEXT_MAX as RENDERER_TEXT_MAX,
  LOG_FACILITIES as RENDERER_FACILITIES,
  MAX_FILTER_NAME_CHARS as RENDERER_NAME_MAX,
  MAX_PROCESS_RATE as RENDERER_RATE_MAX
} from '../../src/renderer/src/screens/logs/logsView'
import {
  logsBundleRequest,
  saveLogsFilterRequest,
  savedFilterName,
  savedFilterRef,
  capturePath,
  crashRef,
  crashReportPath,
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

const everyKey = {
  app: 'com.example.player',
  system: false,
  level: 'e',
  search: 'tick',
  regex: true,
  appsOnly: true,
  lifecycle: true,
  pid: [27178, 0],
  tid: [2842092448],
  tag: ['com.amazon.keplerscript'],
  identity: ['com.example.player'],
  facility: ['user', 'local7'],
  boot: ['current', '0123456789abcdef0123456789abcdef', '01234567-89ab-cdef-0123-456789abcdef'],
  processRules: [
    { identity: 'com.example.player', level: 'W', rate: 10, mute: true },
    { identity: 'lcm_service', rate: MAX_PROCESS_RATE }
  ]
}

describe('logsFilter, the advanced fields', () => {
  test('accepts every key', () => {
    expect(logsFilter(everyKey)).toEqual(everyKey)
  })

  test.each([
    ['a string PID', { pid: ['27178'] }],
    ['a negative PID', { pid: [-1] }],
    ['a fractional TID', { tid: [1.5] }],
    ['an unsafe TID', { tid: [2 ** 60] }],
    ['PIDs that aren’t an array', { pid: 27178 }],
    ['too many PIDs', { pid: Array.from({ length: 101 }, (_, i) => i) }],
    ['an empty tag', { tag: [''] }],
    ['a numeric tag', { tag: [4] }],
    ['a tag with a control character', { tag: ['a\nb'] }],
    ['an overlong identity', { identity: ['x'.repeat(FILTER_TEXT_MAX + 1)] }],
    ['too many identities', { identity: Array.from({ length: 101 }, () => 'x') }],
    ['an unknown facility', { facility: ['kernel'] }],
    ['a bad boot', { boot: ['not-a-boot'] }],
    ['a boot of 31 characters', { boot: ['0123456789abcdef0123456789abcde'] }],
    ['a level that isn’t one', { level: 'fatal' }],
    ['a non-boolean appsOnly', { appsOnly: 1 }],
    ['a non-boolean lifecycle', { lifecycle: 'yes' }],
    ['a search over the bound', { search: 'x'.repeat(4097) }],
    ['an app over the bound', { app: 'x'.repeat(257) }],
    ['rules that aren’t an array', { processRules: {} }],
    ['a rule that isn’t an object', { processRules: ['x'] }],
    ['a rule without an identity', { processRules: [{ mute: true }] }],
    ['a rule that sets nothing', { processRules: [{ identity: 'x' }] }],
    ['a rule with a bad level', { processRules: [{ identity: 'x', level: 'loud' }] }],
    ['a rule rate of 0', { processRules: [{ identity: 'x', rate: 0 }] }],
    [
      'a rule rate over the maximum',
      { processRules: [{ identity: 'x', rate: MAX_PROCESS_RATE + 1 }] }
    ],
    ['a fractional rule rate', { processRules: [{ identity: 'x', rate: 1.5 }] }],
    ['a string rule rate', { processRules: [{ identity: 'x', rate: '5' }] }],
    ['a non-boolean mute', { processRules: [{ identity: 'x', mute: 'yes' }] }],
    ['an unknown rule key', { processRules: [{ identity: 'x', mute: true, path: '/' }] }],
    [
      'too many rules',
      { processRules: Array.from({ length: 101 }, () => ({ identity: 'x', mute: true })) }
    ]
  ])('rejects %s', (_label, value) => {
    expect(() => logsFilter(value)).toThrow(TypeError)
  })

  test.each(['since', 'until', 'out', 'path', 'preset'])('rejects the key %s', (key) => {
    expect(() => logsFilter({ [key]: 'x' })).toThrow(
      new TypeError(`filter.${key} is not a log filter`)
    )
  })

  test('the renderer’s copies of core’s limits match', () => {
    expect(RENDERER_TEXT_MAX).toBe(FILTER_TEXT_MAX)
    expect(RENDERER_RATE_MAX).toBe(MAX_PROCESS_RATE)
    expect(RENDERER_NAME_MAX).toBe(MAX_FILTER_NAME_CHARS)
    expect([...RENDERER_FACILITIES]).toEqual([...LOG_FACILITIES])
  })
})

describe('savedFilterName', () => {
  test.each(['errors', 'a', '0-9', 'a'.repeat(40)])('accepts %s', (name) => {
    expect(savedFilterName(name)).toBe(name)
  })

  test.each([
    ['empty', ''],
    ['too long', 'a'.repeat(41)],
    ['upper case', 'Errors'],
    ['a leading hyphen', '-a'],
    ['a space', 'a b'],
    ['a slash', '../x'],
    ['a number', 4],
    ['undefined', undefined]
  ])('rejects %s', (_label, value) => {
    expect(() => savedFilterName(value)).toThrow(TypeError)
  })
})

describe('savedFilterRef', () => {
  test('lets a stored name that breaks the save rule be deleted', () => {
    expect(savedFilterRef('Odd Name')).toBe('Odd Name')
  })

  test.each([
    ['empty', ''],
    ['too long', 'a'.repeat(161)],
    ['a number', 4]
  ])('rejects %s', (_label, value) => {
    expect(() => savedFilterRef(value)).toThrow(TypeError)
  })
})

describe('saveLogsFilterRequest', () => {
  test('a name, a filter and an optional force', () => {
    expect(saveLogsFilterRequest({ name: 'errors', filter: { level: 'e' } })).toEqual({
      name: 'errors',
      filter: { level: 'e' }
    })
    expect(saveLogsFilterRequest({ name: 'errors', filter: {}, force: true })).toEqual({
      name: 'errors',
      filter: {},
      force: true
    })
  })

  test.each([
    ['no name', { filter: {} }],
    ['a bad name', { name: 'Bad Name', filter: {} }],
    ['no filter', { name: 'errors' }],
    ['a bad filter', { name: 'errors', filter: { pid: ['x'] } }],
    ['a non-boolean force', { name: 'errors', filter: {}, force: 1 }],
    ['a path', { name: 'errors', filter: {}, path: '/tmp/x.json' }],
    ['null', null],
    ['an array', []]
  ])('rejects %s', (_label, value) => {
    expect(() => saveLogsFilterRequest(value)).toThrow(TypeError)
  })
})

describe('logsBundleRequest', () => {
  test('accepts nothing or a throughSeq', () => {
    expect(logsBundleRequest({})).toEqual({})
    expect(logsBundleRequest({ throughSeq: 7 })).toEqual({ throughSeq: 7 })
  })

  test.each([
    ['a path', { out: '/tmp/x.zip' }],
    ['a path next to a seq', { throughSeq: 1, path: '/tmp' }],
    ['a force flag', { force: true }],
    ['a negative seq', { throughSeq: -1 }],
    ['a string seq', { throughSeq: '1' }],
    ['null', null],
    ['a string', '/tmp/x.zip']
  ])('rejects %s', (_label, value) => {
    expect(() => logsBundleRequest(value)).toThrow(TypeError)
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

describe('crashRef', () => {
  test('accepts exactly a device and a vault index', () => {
    expect(crashRef({ device: 'VirtualDevice', id: 2100 })).toEqual({
      device: 'VirtualDevice',
      id: 2100
    })
    expect(crashRef({ device: 'VirtualDevice', id: 0 }).id).toBe(0)
  })

  test.each([
    ['not an object', 'VirtualDevice'],
    ['null', null],
    ['an array', []],
    ['no device', { id: 1 }],
    ['an empty device', { device: '', id: 1 }],
    ['a string id', { device: 'a', id: '1' }],
    ['a negative id', { device: 'a', id: -1 }],
    ['a fractional id', { device: 'a', id: 1.5 }],
    ['an unsafe id', { device: 'a', id: 2 ** 60 }],
    ['a path', { device: 'a', id: 1, path: '/etc/passwd' }],
    ['an out folder', { device: 'a', id: 1, out: '/tmp' }]
  ])('rejects %s', (_label, value) => {
    expect(() => crashRef(value)).toThrow(TypeError)
  })
})

describe('crashReportPath', () => {
  const setup = async () => {
    const root = await mkdtemp(join(tmpdir(), 'ovd-crash-'))
    const dir = join(root, 'crashes')
    await mkdir(dir)
    await mkdir(join(root, 'crashes-evil'))
    await writeFile(join(dir, 'com.example.player-1-2.acr'), 'x')
    await writeFile(join(dir, 'notes.txt'), 'x')
    await writeFile(join(root, 'crashes-evil', 'a.acr'), 'x')
    await writeFile(join(root, 'secret.acr'), 'x')
    await symlink(join(root, 'secret.acr'), join(dir, 'link.acr'))
    return { root, dir }
  }

  test('an .acr inside the crashes folder resolves to its real path', async () => {
    const { dir } = await setup()
    const file = join(dir, 'com.example.player-1-2.acr')
    expect(await crashReportPath(file, dir, realpath)).toBe(await realpath(file))
  })

  test.each([
    ['a path out with ..', (root: string) => join(root, 'crashes', '..', 'secret.acr')],
    ['a sibling sharing the prefix', (root: string) => join(root, 'crashes-evil', 'a.acr')],
    ['a symlink out of the folder', (root: string) => join(root, 'crashes', 'link.acr')],
    ['a file that isn’t an .acr', (root: string) => join(root, 'crashes', 'notes.txt')],
    ['the folder itself', (root: string) => join(root, 'crashes')]
  ])('refuses %s', async (_label, path) => {
    const { root, dir } = await setup()
    await expect(crashReportPath(path(root), dir, realpath)).rejects.toThrow(
      new TypeError('path is not a crash report')
    )
  })

  test.each([[''], [42], [null]])('refuses a payload that isn’t a path: %j', async (value) => {
    await expect(crashReportPath(value, '/tmp', realpath)).rejects.toThrow(TypeError)
  })
})
