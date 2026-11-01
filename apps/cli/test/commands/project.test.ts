import type { FolderProject, VpkgSource } from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import { cli } from '../support/runCli.js'
import { fail, stubProject } from '../support/sample.js'

const folder: FolderProject = {
  kind: 'folder',
  path: '/home/dev/dev/hellovega',
  displayPath: '~/dev/hellovega',
  name: 'hellovega',
  packageId: 'com.example.hellovega',
  version: '0.1.0',
  osTarget: '1.2',
  rnVersion: '0.83'
}
const vpkg: VpkgSource = {
  kind: 'vpkg',
  path: '/home/dev/Downloads/player-1.4.2-armv7.vpkg',
  displayPath: '~/Downloads/player-1.4.2-armv7.vpkg',
  file: 'player-1.4.2-armv7.vpkg'
}

describe('ovd open', () => {
  test('--json prints the opened project', async () => {
    const open = vi.fn(async () => folder)
    const { stdout, exitCode } = await cli(['open', '~/dev/hellovega', '--json'], {
      ovd: stubProject({ open })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, project: folder })
    expect(exitCode).toBe(0)
    expect(open).toHaveBeenCalledWith('~/dev/hellovega')
  })

  test('human output names the project and what it pins', async () => {
    const ovd = stubProject({ open: async () => folder })
    expect((await cli(['open', '.'], { ovd })).stdout).toBe(
      'Opened hellovega (~/dev/hellovega) · OS 1.2 · RN 0.83\n'
    )
  })

  test('a .vpkg switches to no-project mode', async () => {
    const ovd = stubProject({ open: async () => vpkg })
    expect(JSON.parse((await cli(['open', vpkg.path, '--json'], { ovd })).stdout)).toEqual({
      ok: true,
      project: vpkg
    })
    expect((await cli(['open', vpkg.path], { ovd })).stdout).toBe(
      'Loaded player-1.4.2-armv7.vpkg · no project mode\n'
    )
  })

  test.each(['NOT_A_PROJECT', 'NOT_A_VPKG', 'PATH_NOT_FOUND'] as const)(
    '%s is a usage error (exit 2)',
    async (code) => {
      const ovd = stubProject({ open: fail(code) })
      const { stdout, exitCode } = await cli(['open', 'x', '--json'], { ovd })
      expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code } })
      expect(exitCode).toBe(2)
    }
  )

  test('a path is required', async () => {
    expect((await cli(['open'])).exitCode).toBe(2)
  })
})

describe('ovd project', () => {
  test('--json prints the open project', async () => {
    const ovd = stubProject({ current: async () => folder })
    expect(JSON.parse((await cli(['project', '--json'], { ovd })).stdout)).toEqual({
      ok: true,
      project: folder
    })
  })

  test('nothing open is not an error', async () => {
    const ovd = stubProject({ current: async () => null })
    const json = await cli(['project', '--json'], { ovd })
    expect(JSON.parse(json.stdout)).toEqual({ ok: true, project: null })
    expect(json.exitCode).toBe(0)
    const human = await cli(['project'], { ovd })
    expect(human.stdout).toBe('No project open.\n')
    expect(human.stderr).toContain('ovd open <folder|file.vpkg>')
  })

  test('a project folder gone since it was opened says so', async () => {
    const ovd = stubProject({ current: async () => ({ ...folder, missing: true as const }) })
    const human = await cli(['project'], { ovd })
    expect(human.stdout).toContain('no longer a Vega project')
    expect(human.stderr).toContain('ovd open <path>')
    const json = await cli(['project', '--json'], { ovd })
    expect(JSON.parse(json.stdout)).toMatchObject({ project: { missing: true } })
  })
})

describe('ovd close', () => {
  test('--json prints no project', async () => {
    const close = vi.fn(async () => undefined)
    const { stdout } = await cli(['close', '--json'], { ovd: stubProject({ close }) })
    expect(JSON.parse(stdout)).toEqual({ ok: true, project: null })
    expect(close).toHaveBeenCalled()
  })
})
