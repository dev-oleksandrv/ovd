import type { Check, DoctorReport, FolderProject, ProjectMode, VpkgSource } from '@ovd/core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { IpcResult, OvdApi } from '../../../src/preload/api'
import { App } from '../../../src/renderer/src/App'
import { FeedbackProvider } from '../../../src/renderer/src/feedback/FeedbackProvider'
import { stick, vvd } from '../screens/devices/sample'
import { doctorReport, ready, stubOvd } from '../support/ovdStub'

const folder: FolderProject = {
  kind: 'folder',
  path: '/home/dev/dev/sample-player',
  displayPath: '~/dev/sample-player',
  name: 'sample-player',
  osTarget: '1.2',
  rnVersion: '0.72'
}
const vpkg: VpkgSource = {
  kind: 'vpkg',
  path: '/home/dev/Downloads/player-1.4.2-armv7.vpkg',
  displayPath: '~/Downloads/player-1.4.2-armv7.vpkg',
  file: 'player-1.4.2-armv7.vpkg'
}
const opened = (mode: ProjectMode | null): IpcResult<ProjectMode | null> => ({
  ok: true,
  data: mode
})

const projectRow = (row: Partial<Check>): DoctorReport => {
  const base = doctorReport()
  const project: Check = {
    id: 'project',
    name: 'Project',
    status: 'info',
    detail: 'No project open',
    ...row
  }
  return {
    ...base,
    checks: [base.checks[0], base.checks[1], project, ...base.checks.slice(2)] as Check[]
  }
}

async function renderApp(
  opts: {
    current?: ProjectMode | null
    project?: Partial<OvdApi['project']>
    reports?: DoctorReport[]
  } = {}
): Promise<OvdApi> {
  let call = 0
  const reports = opts.reports ?? [projectRow({})]
  const { api } = stubOvd({
    list: async () => ready([stick, vvd], stick.id),
    devices: [stick, vvd],
    doctor: () => ({
      ok: true,
      data: reports[Math.min(call++, reports.length - 1)] as DoctorReport
    }),
    project: { current: async () => opened(opts.current ?? null), ...opts.project }
  })
  render(
    <FeedbackProvider>
      <App />
    </FeedbackProvider>
  )
  await screen.findByRole('region', { name: 'Project' })
  return api
}

const card = () => screen.getByRole('region', { name: 'Project' })
// The echo prefixes the command, so match it inside the text.
const statusEcho = (cli: string) =>
  screen.getAllByText((_, el) => el?.children.length === 0 && (el.textContent ?? '').includes(cli))
    .length > 0

describe('project card', () => {
  test('no project: offers a .vpkg and a project folder', async () => {
    await renderApp()
    expect(within(card()).getByText('No project')).toBeTruthy()
    expect(within(card()).getByText('Drop a .vpkg')).toBeTruthy()
    expect(within(card()).getByRole('button', { name: 'Open a project folder…' })).toBeTruthy()
  })

  test('an open project shows its folder, path and what it pins, never an SDK version', async () => {
    await renderApp({ current: folder })
    const c = within(card())
    expect(c.getByText('sample-player')).toBeTruthy()
    expect(c.getByText('~/dev/sample-player')).toBeTruthy()
    expect(c.getByText('OS 1.2 · RN 0.72')).toBeTruthy()
    expect(card().textContent).not.toMatch(/SDK/)
  })

  test('opening a folder switches modes, toasts, echoes ovd open and re-runs doctor', async () => {
    const api = await renderApp({ project: { pickFolder: async () => opened(folder) } })
    const runs = vi.mocked(api.doctor.run).mock.calls.length
    fireEvent.click(within(card()).getByRole('button', { name: 'Open a project folder…' }))
    expect(await screen.findByText('Opened sample-player')).toBeTruthy()
    expect(statusEcho('ovd open ~/dev/sample-player')).toBe(true)
    expect(within(card()).getByText('OS 1.2 · RN 0.72')).toBeTruthy()
    expect(vi.mocked(api.doctor.run).mock.calls.length).toBe(runs + 1)
  })

  test('a cancelled picker changes nothing', async () => {
    const api = await renderApp({ project: { pickVpkg: async () => opened(null) } })
    fireEvent.click(within(card()).getByRole('button', { name: /No project/ }))
    await act(async () => undefined)
    expect(api.project.pickVpkg).toHaveBeenCalled()
    expect(within(card()).getByText('No project')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('dropping a .vpkg anywhere opens it in no-project mode', async () => {
    const open = vi.fn(async () => opened(vpkg) as IpcResult<ProjectMode>)
    await renderApp({ project: { open } })
    const file = new File(['vpkg'], 'player-1.4.2-armv7.vpkg')
    const dataTransfer = { types: ['Files'], files: [file] }
    fireEvent.dragEnter(window, { dataTransfer })
    expect(within(card()).getByText('Drop to open')).toBeTruthy()
    fireEvent.drop(window, { dataTransfer })
    expect(open).toHaveBeenCalledWith('/home/dev/Downloads/player-1.4.2-armv7.vpkg')
    expect(await screen.findByText('Loaded player-1.4.2-armv7.vpkg')).toBeTruthy()
    expect(statusEcho('ovd open ~/Downloads/player-1.4.2-armv7.vpkg')).toBe(true)
    expect(within(card()).getByText('player-1.4.2-armv7.vpkg')).toBeTruthy()
    expect(within(card()).getByText('Drop a .vpkg')).toBeTruthy()
  })

  test('a folder that is not a project shows the error and keeps no-project mode', async () => {
    await renderApp({
      project: {
        pickFolder: async () => ({
          ok: false,
          error: {
            code: 'NOT_A_PROJECT',
            message: 'Not a Vega project: no manifest.toml in ~/dev/plain',
            hint: 'Open the folder that holds manifest.toml and package.json'
          }
        })
      }
    })
    fireEvent.click(within(card()).getByRole('button', { name: 'Open a project folder…' }))
    expect(
      await screen.findByText('Not a Vega project: no manifest.toml in ~/dev/plain')
    ).toBeTruthy()
    expect(within(card()).getByText('No project')).toBeTruthy()
  })
})

describe('Doctor → Project row', () => {
  const warned = projectRow({
    status: 'warn',
    detail: 'vega project doctor · 0 errors, 1 warning',
    command: 'vega project doctor',
    project: {
      checks: [
        { name: 'SDK manifest', status: 'ok', message: '1 OS versions, 2 RN versions' },
        {
          name: 'Scoped deps in profile',
          status: 'warn',
          message: 'eslint-plugin-kepler not managed'
        }
      ],
      fixes: ['Docs: https://developer.amazon.com/docs/vega/latest/vega-get-started.html'],
      failed: 0,
      warnings: 1,
      output: '🩺 Project Doctor\n'
    }
  })

  async function openDoctor(opts: Parameters<typeof renderApp>[0]): Promise<OvdApi> {
    const api = await renderApp(opts)
    fireEvent.click(screen.getByRole('button', { name: 'Doctor' }))
    await screen.findByRole('list', { name: 'Checks' })
    return api
  }

  test('nothing open: "Open folder…" opens the folder picker', async () => {
    const api = await openDoctor({ project: { pickFolder: async () => opened(null) } })
    fireEvent.click(await screen.findByRole('button', { name: 'Open folder…' }))
    expect(api.project.pickFolder).toHaveBeenCalled()
  })

  test('Details lists every check, links the fix hints and copies the output', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    await openDoctor({ current: folder, reports: [warned] })
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }))
    const dialog = screen.getByRole('dialog', { name: 'Project doctor · sample-player' })
    const d = within(dialog)
    expect(d.getByText('~/dev/sample-player')).toBeTruthy()
    expect(d.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'check_circleSDK manifest1 OS versions, 2 RN versions',
      'errorScoped deps in profileeslint-plugin-kepler not managed'
    ])
    const link = d.getByRole('link')
    expect(link.getAttribute('href')).toBe(
      'https://developer.amazon.com/docs/vega/latest/vega-get-started.html'
    )
    expect(d.getByText('1 warning')).toBeTruthy()
    fireEvent.click(d.getByRole('button', { name: /Copy output/ }))
    expect(writeText).toHaveBeenCalledWith('🩺 Project Doctor\n')
    expect(await screen.findByText('Copied doctor output')).toBeTruthy()
  })

  test('Re-run runs doctor again and updates the dialog', async () => {
    const fixed = projectRow({
      status: 'ok',
      detail: 'vega project doctor · all checks passed',
      command: 'vega project doctor',
      project: { checks: [], fixes: [], failed: 0, warnings: 0, output: '' }
    })
    await openDoctor({ current: folder, reports: [warned, fixed] })
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }))
    fireEvent.click(screen.getByRole('button', { name: /Re-run/ }))
    expect(await screen.findByText('Project doctor finished')).toBeTruthy()
    expect(within(screen.getByRole('dialog')).getByText('All checks passed')).toBeTruthy()
  })
})
