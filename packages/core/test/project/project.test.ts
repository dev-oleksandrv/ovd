import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createProject, createStateStore, OvdError } from '../../src/index.js'

const MANIFEST = `schema-version = 1

[package]
title = "Hello Vega"
version = "0.1.0"
id = "com.example.hellovega"

[os.version]
min = "1.2"
target = "1.2"
`
const PACKAGE_JSON = JSON.stringify({ dependencies: { 'react-native': '0.83.0' } })

let home: string
let ovdHome: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ovd-project-'))
  ovdHome = join(home, '.config', 'ovd')
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

async function makeProject(name: string, files: Record<string, string>): Promise<string> {
  const folder = join(home, 'dev', name)
  await mkdir(folder, { recursive: true })
  for (const [file, text] of Object.entries(files)) await writeFile(join(folder, file), text)
  return folder
}

async function makeVpkg(name: string, bytes = 'vpkg'): Promise<string> {
  await mkdir(join(home, 'Downloads'), { recursive: true })
  const path = join(home, 'Downloads', name)
  await writeFile(path, bytes)
  return path
}

function setup(cwd = home) {
  const state = createStateStore(ovdHome)
  return { project: createProject({ state, homedir: home, cwd }), state }
}

describe('Project.open', () => {
  test('a project folder: reads what it pins and remembers it', async () => {
    const folder = await makeProject('hellovega', {
      'manifest.toml': MANIFEST,
      'package.json': PACKAGE_JSON
    })
    const { project, state } = setup()
    expect(await project.open(folder)).toEqual({
      kind: 'folder',
      path: folder,
      displayPath: '~/dev/hellovega',
      name: 'hellovega',
      packageId: 'com.example.hellovega',
      title: 'Hello Vega',
      version: '0.1.0',
      osTarget: '1.2',
      rnVersion: '0.83'
    })
    expect((await state.read()).state.project).toEqual({ kind: 'folder', path: folder })
  })

  test('resolves ~ and relative paths', async () => {
    const folder = await makeProject('hellovega', {
      'manifest.toml': MANIFEST,
      'package.json': PACKAGE_JSON
    })
    expect((await setup().project.open('~/dev/hellovega')).path).toBe(folder)
    expect((await setup(join(home, 'dev')).project.open('hellovega')).path).toBe(folder)
  })

  test('a project without OS or RN versions still opens, without them', async () => {
    const folder = await makeProject('bare', {
      'manifest.toml': 'schema-version = 1\n',
      'package.json': '{}'
    })
    const opened = await setup().project.open(folder)
    expect(opened).not.toHaveProperty('osTarget')
    expect(opened).not.toHaveProperty('rnVersion')
  })

  test.each([
    ['^0.72.4', '0.72'],
    ['~0.72', '0.72'],
    ['*', undefined]
  ])('react-native %s reads as %s', async (range, expected) => {
    const folder = await makeProject('rn', {
      'manifest.toml': MANIFEST,
      'package.json': JSON.stringify({ dependencies: { 'react-native': range } })
    })
    const opened = await setup().project.open(folder)
    expect(opened.kind === 'folder' ? opened.rnVersion : null).toBe(expected)
  })

  test.each([
    ['manifest.toml', { 'package.json': PACKAGE_JSON }],
    ['package.json', { 'manifest.toml': MANIFEST }]
  ])('a folder without %s is not a project', async (missing, files) => {
    const folder = await makeProject('plain', files)
    const { project, state } = setup()
    const error = await project.open(folder).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(OvdError)
    expect(error).toMatchObject({
      code: 'NOT_A_PROJECT',
      message: `Not a Vega project: no ${missing} in ~/dev/plain`
    })
    expect((await state.read()).state.project).toBeUndefined()
  })

  test('a .vpkg switches to no-project mode', async () => {
    const path = await makeVpkg('player-1.4.2-armv7.vpkg')
    const { project, state } = setup()
    expect(await project.open(path)).toEqual({
      kind: 'vpkg',
      path,
      displayPath: '~/Downloads/player-1.4.2-armv7.vpkg',
      file: 'player-1.4.2-armv7.vpkg'
    })
    expect((await state.read()).state.project).toEqual({ kind: 'vpkg', path })
  })

  test.each([
    ['another file type', 'notes.txt', 'text'],
    ['an empty .vpkg', 'empty.vpkg', '']
  ])('%s is not a .vpkg', async (_case, name, bytes) => {
    const path = await makeVpkg(name, bytes)
    await expect(setup().project.open(path)).rejects.toMatchObject({ code: 'NOT_A_VPKG' })
  })

  test('a path that does not exist', async () => {
    await expect(setup().project.open('~/dev/nope')).rejects.toMatchObject({
      code: 'PATH_NOT_FOUND',
      message: '~/dev/nope doesn’t exist'
    })
  })
})

describe('Project.current and close', () => {
  test('nothing open', async () => {
    expect(await setup().project.current()).toBeNull()
  })

  test('another surface sees what was opened, read fresh from disk', async () => {
    const folder = await makeProject('hellovega', {
      'manifest.toml': MANIFEST,
      'package.json': PACKAGE_JSON
    })
    await setup().project.open(folder)
    await writeFile(
      join(folder, 'manifest.toml'),
      MANIFEST.replace('target = "1.2"', 'target = "1.3"')
    )
    expect(await setup().project.current()).toMatchObject({ kind: 'folder', osTarget: '1.3' })
  })

  test('a project folder removed since it was opened is reported missing', async () => {
    const folder = await makeProject('hellovega', {
      'manifest.toml': MANIFEST,
      'package.json': PACKAGE_JSON
    })
    const { project } = setup()
    await project.open(folder)
    await rm(folder, { recursive: true })
    expect(await project.current()).toEqual({
      kind: 'folder',
      path: folder,
      displayPath: '~/dev/hellovega',
      name: 'hellovega',
      missing: true
    })
  })

  test('close forgets the project and keeps the rest of the state', async () => {
    const path = await makeVpkg('player-1.4.2-armv7.vpkg')
    const { project, state } = setup()
    await state.update((s) => ({ ...s, target: 'VirtualDevice' }))
    await project.open(path)
    await project.close()
    expect(await project.current()).toBeNull()
    expect((await state.read()).state).toEqual({
      version: 1,
      target: 'VirtualDevice',
      names: {},
      saved: []
    })
  })
})
