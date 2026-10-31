import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Check, DoctorReport } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import { ovd } from '../harness/cli.ts'
import { BROKEN_MANIFEST, makeProject, makeVpkg } from '../harness/project.ts'
import { createSandbox } from '../harness/vitest.ts'

type Report = DoctorReport & { ok: true }
const PROJECT_DOCTOR = 'vega project doctor'

const projectRow = (report: Report): Check | undefined =>
  report.checks.find((c) => c.id === 'project')

describe('project mode and no-project mode', () => {
  test('opening a folder, then a .vpkg, switches modes and Doctor follows', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()
    const folder = makeProject(sandbox.home)

    const opened = await ovd(sandbox, ['open', '~/dev/hellovega', '--json'])

    expect(opened.exitCode).toBe(0)
    expect(opened.json()).toEqual({
      ok: true,
      project: {
        kind: 'folder',
        path: folder,
        displayPath: '~/dev/hellovega',
        name: 'hellovega',
        packageId: 'com.example.hellovega',
        title: 'Basic UI React Native Application for project hellovega',
        version: '0.1.0',
        osTarget: '1.2',
        rnVersion: '0.83'
      }
    })
    expect(sandbox.hostState()).toMatchObject({ project: { kind: 'folder', path: folder } })
    // Opening reads the project's files; it runs no SDK command.
    expect(sandbox.calls()).toEqual([])

    const doctor = await ovd(sandbox, ['doctor', '--json'])
    expect(projectRow(doctor.json<Report>())).toMatchObject({
      status: 'warn',
      detail: 'vega project doctor · 0 errors, 1 warning',
      command: PROJECT_DOCTOR,
      project: { failed: 0, warnings: 1 }
    })
    expect(sandbox.calls()).toContain(PROJECT_DOCTOR)

    const vpkg = makeVpkg(sandbox.home)
    const switched = await ovd(sandbox, ['open', vpkg, '--json'])
    expect(switched.json()).toEqual({
      ok: true,
      project: {
        kind: 'vpkg',
        path: vpkg,
        displayPath: '~/Downloads/player-1.4.2-armv7.vpkg',
        file: 'player-1.4.2-armv7.vpkg'
      }
    })
    expect((await ovd(sandbox, ['project', '--json'])).json()).toMatchObject({
      project: { kind: 'vpkg', file: 'player-1.4.2-armv7.vpkg' }
    })

    sandbox.clearCalls()
    const noProject = await ovd(sandbox, ['doctor', '--json'])
    expect(projectRow(noProject.json<Report>())).toMatchObject({
      status: 'ok',
      detail: 'No project open · installing from player-1.4.2-armv7.vpkg'
    })
    expect(sandbox.calls()).not.toContain(PROJECT_DOCTOR)
  })

  test('a project that fails vega project doctor fails Doctor with the checks that failed', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()
    makeProject(sandbox.home, 'hellovega', { manifest: BROKEN_MANIFEST })
    await ovd(sandbox, ['open', '~/dev/hellovega'])

    const doctor = await ovd(sandbox, ['doctor', '--json'])

    expect(doctor.exitCode).toBe(1)
    const row = projectRow(doctor.json<Report>())
    expect(row).toMatchObject({
      status: 'fail',
      detail: 'vega project doctor · 2 checks failed, 2 warnings'
    })
    expect(row?.project?.output).toContain('is not minted')
  })

  test('nothing open: Doctor says so and runs no project command', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()

    const doctor = await ovd(sandbox, ['doctor', '--json'])

    expect(projectRow(doctor.json<Report>())).toEqual({
      id: 'project',
      name: 'Project',
      status: 'info',
      detail: 'No project open'
    })
    expect(sandbox.calls()).not.toContain(PROJECT_DOCTOR)
    const human = await ovd(sandbox, ['project'])
    expect(human.stdout).toBe('No project open.\n')
  })

  test.each([
    ['a folder without manifest.toml', 'NOT_A_PROJECT', { manifest: null }],
    ['a folder without package.json', 'NOT_A_PROJECT', { packageJson: null }]
  ] as const)('%s is refused with exit 2 and changes nothing', async (_case, code, files) => {
    const sandbox = createSandbox()
    makeProject(sandbox.home, 'plain', files)

    const run = await ovd(sandbox, ['open', '~/dev/plain', '--json'])

    expect(run.exitCode).toBe(2)
    expect(run.json()).toMatchObject({ ok: false, error: { code } })
    expect(sandbox.hostState()).toBeNull()
  })

  test('a file that is not a .vpkg, and a missing path, are refused with exit 2', async () => {
    const sandbox = createSandbox()
    const notes = join(sandbox.home, 'notes.txt')
    writeFileSync(notes, 'text')

    const wrongFile = await ovd(sandbox, ['open', notes, '--json'])
    expect(wrongFile.exitCode).toBe(2)
    expect(wrongFile.json()).toMatchObject({ error: { code: 'NOT_A_VPKG' } })

    const missing = await ovd(sandbox, ['open', '~/dev/nope', '--json'])
    expect(missing.exitCode).toBe(2)
    expect(missing.json()).toMatchObject({ error: { code: 'PATH_NOT_FOUND' } })
  })

  test('a project folder deleted after opening is reported, and Doctor runs nothing for it', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()
    const folder = makeProject(sandbox.home)
    await ovd(sandbox, ['open', folder])
    rmSync(folder, { recursive: true })

    expect((await ovd(sandbox, ['project', '--json'])).json()).toMatchObject({
      project: { kind: 'folder', missing: true }
    })
    const doctor = await ovd(sandbox, ['doctor', '--json'])
    expect(projectRow(doctor.json<Report>())).toMatchObject({
      status: 'fail',
      detail: '~/dev/hellovega is no longer a Vega project'
    })
    expect(sandbox.calls()).not.toContain(PROJECT_DOCTOR)
  })

  test('close forgets the project and keeps the target', async () => {
    const sandbox = createSandbox()
    makeProject(sandbox.home)
    await ovd(sandbox, ['open', '~/dev/hellovega'])

    const closed = await ovd(sandbox, ['close', '--json'])

    expect(closed.json()).toEqual({ ok: true, project: null })
    expect(sandbox.hostState()).not.toHaveProperty('project')
  })
})
