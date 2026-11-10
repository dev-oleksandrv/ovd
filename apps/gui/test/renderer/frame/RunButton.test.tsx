import type {
  Device,
  FolderProject,
  ProjectMode,
  RestartResult,
  RunOutcome,
  VpkgSource
} from '@ovd/core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { IpcResult, OvdApi } from '../../../src/preload/api'
import { App } from '../../../src/renderer/src/App'
import { FeedbackProvider } from '../../../src/renderer/src/feedback/FeedbackProvider'
import { vvd } from '../screens/devices/sample'
import { ready, stubOvd, type OvdStub } from '../support/ovdStub'

const folder: FolderProject = {
  kind: 'folder',
  path: '/home/dev/dev/hellovega',
  displayPath: '~/dev/hellovega',
  name: 'hellovega',
  packageId: 'com.example.hellovega'
}
const vpkg: VpkgSource = {
  kind: 'vpkg',
  path: '/home/dev/Downloads/player_aarch64.vpkg',
  displayPath: '~/Downloads/player_aarch64.vpkg',
  file: 'player_aarch64.vpkg'
}
const online: Device = { ...vvd, status: 'online', isTarget: true, vdaSerial: 'emulator-5554' }
const target = { id: 'VirtualDevice', name: 'Vega Virtual Device', architecture: 'aarch64' }
const pkg = {
  path: '/home/dev/dev/hellovega/build/aarch64-debug/hellovega_aarch64.vpkg',
  displayPath: '~/dev/hellovega/build/aarch64-debug/hellovega_aarch64.vpkg',
  file: 'hellovega_aarch64.vpkg',
  id: 'com.example.hellovega',
  title: 'Hello Vega',
  version: '0.1.0',
  buildNumber: 1,
  architecture: 'any' as const,
  buildType: 'debug' as const,
  folder: 'build/aarch64-debug/'
}
const launchBase = {
  target: { id: target.id, name: target.name },
  app: { packageId: pkg.id, title: pkg.title, componentId: 'com.example.hellovega.main' },
  wasRunning: false,
  launched: true as const
}
const verified: RestartResult = { ...launchBase, verified: true, pid: 3571 }
const crashed: RestartResult = {
  ...launchBase,
  verified: false,
  reason: 'crashed',
  crash: {
    pid: 3200,
    time: '2026-11-08T01:51:44.657Z',
    signal: 'SIGABRT',
    message: 'Error: deliberate crash',
    stack: [],
    logs: []
  }
}
const outcome = (launch: RestartResult): IpcResult<RunOutcome> => ({
  ok: true,
  data: { target, package: pkg, forced: false, launch }
})

async function renderApp(opts: {
  mode?: ProjectMode | null
  devices?: Device[]
  target?: string | null
  start?: OvdApi['run']['start']
}): Promise<OvdStub> {
  const devices = opts.devices ?? [online]
  const stub = stubOvd({
    list: async () => ready(devices, opts.target === undefined ? online.id : opts.target),
    devices,
    project: { current: async () => ({ ok: true, data: opts.mode ?? null }) },
    ...(opts.start ? { run: { start: opts.start } } : {})
  })
  render(
    <FeedbackProvider>
      <App />
    </FeedbackProvider>
  )
  await screen.findByRole('list', { name: 'Devices' }).catch(() => undefined)
  return stub
}

const runButton = (name: RegExp | string = /^Run/) => screen.getByRole('button', { name })

describe('Run button', () => {
  test.each([
    ['nothing open', null, [online], online.id, 'Run', 'Open a project or drop a .vpkg'],
    ['no target', folder, [vvd], null, 'Run ▸ hellovega', 'Pick a target first'],
    [
      'a stopped Virtual Device',
      folder,
      [vvd],
      vvd.id,
      'Run ▸ hellovega',
      'Vega Virtual Device is offline'
    ]
  ])('disabled with %s: says why', async (_name, mode, devices, targetId, label, reason) => {
    await renderApp({ mode, devices, target: targetId })
    const button = (await screen.findByRole('button', { name: label })) as HTMLButtonElement
    await vi.waitFor(() => expect(button.title).toBe(reason))
    expect(button.disabled).toBe(true)
  })

  test('a .vpkg open: Run ▸ <file>', async () => {
    await renderApp({ mode: vpkg })
    expect(await screen.findByRole('button', { name: 'Run ▸ player_aarch64.vpkg' })).toBeTruthy()
  })

  test('a run shows each step, echoes ovd run --device and opens Logs when verified', async () => {
    let finish: (result: IpcResult<RunOutcome>) => void = () => undefined
    const start = vi.fn(() => new Promise<IpcResult<RunOutcome>>((resolve) => (finish = resolve)))
    const stub = await renderApp({ mode: folder, start })
    const button = (await screen.findByRole('button', {
      name: 'Run ▸ hellovega'
    })) as HTMLButtonElement
    await vi.waitFor(() => expect(button.disabled).toBe(false))

    fireEvent.click(button)
    expect(start).toHaveBeenCalledWith('VirtualDevice')
    const steps = screen.getByRole('region', { name: 'Run steps' })
    expect(within(steps).getByText('ovd run --device VirtualDevice')).toBeTruthy()
    expect(within(steps).getByRole('listitem', { name: 'Pick build: in progress' })).toBeTruthy()
    // A second click can't start another run.
    expect(button.disabled).toBe(true)
    expect(button.title).toBe('A run is in progress')

    act(() => {
      stub.pushRun({ kind: 'step', step: { step: 'build', package: pkg, target } })
      stub.pushRun({ kind: 'step', step: { step: 'install', package: pkg, target } })
    })
    expect(
      within(steps).getByText('build/aarch64-debug/hellovega_aarch64.vpkg · debug')
    ).toBeTruthy()
    expect(within(steps).getByRole('listitem', { name: 'Install: in progress' })).toBeTruthy()

    await act(async () => finish(outcome(verified)))
    expect(within(steps).getByRole('listitem', { name: 'Following logs: done' })).toBeTruthy()
    expect(
      await screen.findByText('Running hellovega_aarch64.vpkg on Vega Virtual Device · verified')
    ).toBeTruthy()
    // The Logs screen opened.
    expect(stub.api.logs.open).toHaveBeenCalledWith('VirtualDevice')
  })

  test('a crash: Verify launch failed, an error toast with Open Logs', async () => {
    const stub = await renderApp({ mode: folder, start: async () => outcome(crashed) })
    const button = (await screen.findByRole('button', {
      name: 'Run ▸ hellovega'
    })) as HTMLButtonElement
    await vi.waitFor(() => expect(button.disabled).toBe(false))

    fireEvent.click(button)

    const steps = screen.getByRole('region', { name: 'Run steps' })
    expect(
      await within(steps).findByRole('listitem', { name: 'Verify launch: failed' })
    ).toBeTruthy()
    expect(within(steps).getByText('Crashed on launch · Error: deliberate crash')).toBeTruthy()
    expect(await screen.findByText('Hello Vega: Crashed on launch')).toBeTruthy()
    expect(stub.api.logs.open).not.toHaveBeenCalled()
    const toastAction = screen
      .getAllByRole('button', { name: 'Open Logs' })
      .find((b) => !steps.contains(b))
    expect(toastAction).toBeTruthy()
    if (toastAction) fireEvent.click(toastAction)
    await vi.waitFor(() => expect(stub.api.logs.open).toHaveBeenCalledWith('VirtualDevice'))
  })

  test('a run main rejects: the step fails, an error toast, and Run works again', async () => {
    const start = vi
      .fn<OvdApi['run']['start']>()
      .mockRejectedValueOnce(new Error('a run is already in progress'))
      .mockResolvedValueOnce(outcome(verified))
    await renderApp({ mode: folder, start })
    const button = (await screen.findByRole('button', {
      name: 'Run ▸ hellovega'
    })) as HTMLButtonElement
    await vi.waitFor(() => expect(button.disabled).toBe(false))

    fireEvent.click(button)

    const steps = screen.getByRole('region', { name: 'Run steps' })
    expect(await within(steps).findByRole('listitem', { name: 'Pick build: failed' })).toBeTruthy()
    expect(within(steps).getByText('Couldn’t start the run')).toBeTruthy()
    const toast = await screen.findByText(
      'Couldn’t start the run. A run may still be in progress: wait for it to finish, then try again.'
    )
    expect(toast.closest('[role="status"]')?.textContent).toContain(
      '$ ovd run --device VirtualDevice'
    )
    await vi.waitFor(() => expect(button.disabled).toBe(false))

    fireEvent.click(button)
    expect(start).toHaveBeenCalledTimes(2)
    expect(
      await within(steps).findByRole('listitem', { name: 'Following logs: done' })
    ).toBeTruthy()
  })

  test('Esc closes the steps; the chevron shows them again', async () => {
    await renderApp({ mode: folder, start: async () => outcome(verified) })
    const button = (await screen.findByRole('button', {
      name: 'Run ▸ hellovega'
    })) as HTMLButtonElement
    await vi.waitFor(() => expect(button.disabled).toBe(false))
    fireEvent.click(button)
    await screen.findByRole('listitem', { name: 'Following logs: done' })

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Run steps' })).toBeNull()
    fireEvent.click(runButton('Show run steps'))
    expect(screen.getByRole('region', { name: 'Run steps' })).toBeTruthy()
  })
})
