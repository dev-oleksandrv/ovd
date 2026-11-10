import type {
  Device,
  FolderProject,
  PackageBuild,
  ProjectMode,
  RestartResult,
  RunOutcome,
  VpkgSource
} from '@ovd/core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { IpcResult, OvdApi, WatchState } from '../../../src/preload/api'
import { App } from '../../../src/renderer/src/App'
import { FeedbackProvider } from '../../../src/renderer/src/feedback/FeedbackProvider'
import { vvd } from '../screens/devices/sample'
import { ready, stubOvd, type OvdStub } from '../support/ovdStub'

const folder: FolderProject = {
  kind: 'folder',
  path: '/home/dev/dev/player',
  displayPath: '~/dev/player',
  name: 'player',
  packageId: 'com.example.player'
}
const other: FolderProject = {
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
const build: PackageBuild = {
  path: '/home/dev/dev/player/build/aarch64-debug/player_aarch64.vpkg',
  displayPath: '~/dev/player/build/aarch64-debug/player_aarch64.vpkg',
  file: 'player_aarch64.vpkg',
  folder: 'build/aarch64-debug/',
  size: 1_000,
  modifiedAt: '2026-11-10T09:05:00.000Z',
  folderArch: 'aarch64',
  folderBuildType: 'debug'
}
const pkg = {
  path: build.path,
  displayPath: build.displayPath,
  file: build.file,
  id: 'com.example.player',
  title: 'Sample Player',
  version: '1.4.2',
  buildNumber: 142,
  architecture: 'aarch64' as const,
  buildType: 'debug' as const
}
const verified: RestartResult = {
  target: { id: target.id, name: target.name },
  app: { packageId: pkg.id, title: pkg.title, componentId: 'com.example.player.main' },
  wasRunning: true,
  launched: true,
  verified: true,
  pid: 3571
}
const redeployed: IpcResult<RunOutcome> = {
  ok: true,
  data: { target, package: pkg, forced: false, launch: verified }
}
const CLI = 'ovd run --watch --device VirtualDevice'

async function renderApp(opts: {
  mode?: ProjectMode | null
  devices?: Device[]
  target?: string | null
  watch?: Partial<Omit<OvdApi['watch'], 'onEvent'>>
  open?: OvdApi['project']['open']
}): Promise<OvdStub> {
  const devices = opts.devices ?? [online]
  const stub = stubOvd({
    list: async () => ready(devices, opts.target === undefined ? online.id : opts.target),
    devices,
    project: {
      current: async () => ({ ok: true, data: opts.mode ?? null }),
      ...(opts.open ? { open: opts.open } : {})
    },
    ...(opts.watch ? { watch: opts.watch } : {})
  })
  render(
    <FeedbackProvider>
      <App />
    </FeedbackProvider>
  )
  await screen.findByRole('list', { name: 'Devices' }).catch(() => undefined)
  return stub
}

const toggle = (name: string) => screen.findByRole('button', { name }) as Promise<HTMLButtonElement>

describe('Watch toggle', () => {
  test.each<[string, ProjectMode | null]>([
    ['nothing open', null],
    ['a .vpkg open', vpkg],
    ['a folder that is gone', { ...folder, missing: true }]
  ])('hidden with %s', async (_name, mode) => {
    await renderApp({ mode })
    await screen.findByRole('button', { name: /^Run/ })
    expect(screen.queryByRole('button', { name: 'Watch off' })).toBeNull()
  })

  test.each([
    ['no target', [vvd], null, 'Pick a target first'],
    ['a stopped Virtual Device', [vvd], vvd.id, 'Vega Virtual Device is offline']
  ])('turning it on is disabled with %s, with the reason', async (_n, devices, id, reason) => {
    await renderApp({ mode: folder, devices, target: id })
    const button = await toggle('Watch off')
    await vi.waitFor(() => expect(button.title).toBe(reason))
    expect(button.disabled).toBe(true)
  })

  test('on: "Watching build/", an info toast with the CLI echo; off again: "Watch off"', async () => {
    const stub = await renderApp({ mode: folder })
    const button = await toggle('Watch off')
    await vi.waitFor(() => expect(button.disabled).toBe(false))

    fireEvent.click(button)
    expect(await toggle('Watching build/')).toBeTruthy()
    expect(stub.api.watch.set).toHaveBeenCalledWith(true)
    const on = await screen.findByText('Watching build/ for new builds')
    expect(on.closest('[role="status"]')?.textContent).toContain(`$ ${CLI}`)
    expect(screen.getByTitle('Copy CLI equivalent').textContent).toContain(CLI)

    fireEvent.click(await toggle('Watching build/'))
    expect(await toggle('Watch off')).toBeTruthy()
    expect(stub.api.watch.set).toHaveBeenLastCalledWith(false)
    expect(await screen.findByText('Watch off', { selector: '[role="status"] *' })).toBeTruthy()
  })

  test('main says it is already on after a reload', async () => {
    await renderApp({
      mode: folder,
      watch: {
        state: async (): Promise<WatchState> => ({ watching: true, folder: '~/dev/player' })
      }
    })
    expect(await toggle('Watching build/')).toBeTruthy()
  })

  test('a failed start: an error toast, and it stays off', async () => {
    await renderApp({
      mode: folder,
      watch: {
        set: async () => ({
          ok: false,
          error: {
            code: 'NOT_A_PROJECT',
            message: 'ovd run --watch needs a project folder',
            hint: 'Pass a project folder or open one with ovd open <folder>'
          }
        })
      }
    })
    const button = await toggle('Watch off')
    await vi.waitFor(() => expect(button.disabled).toBe(false))
    fireEvent.click(button)
    expect(
      await screen.findByText(
        'ovd run --watch needs a project folder. Pass a project folder or open one with ovd open <folder>'
      )
    ).toBeTruthy()
    expect(await toggle('Watch off')).toBeTruthy()
  })

  test('a build: the run steps start, then the redeploy toast; Run is disabled meanwhile', async () => {
    const stub = await renderApp({ mode: folder })
    const button = await toggle('Watch off')
    await vi.waitFor(() => expect(button.disabled).toBe(false))
    fireEvent.click(button)
    await toggle('Watching build/')

    act(() => {
      stub.pushWatch({
        kind: 'changed',
        change: { folder: '~/dev/player', changed: [build], build, target }
      })
    })
    const run = screen.getByRole('button', { name: 'Run ▸ player' }) as HTMLButtonElement
    expect(run.disabled).toBe(true)
    expect(run.title).toBe('A run is in progress')
    fireEvent.click(screen.getByRole('button', { name: 'Show run steps' }))
    const steps = screen.getByRole('region', { name: 'Run steps' })
    expect(within(steps).getByRole('listitem', { name: 'Pick build: in progress' })).toBeTruthy()

    act(() => stub.pushWatch({ kind: 'redeployed', device: 'VirtualDevice', result: redeployed }))
    const toast = await screen.findByText(
      'Redeployed player_aarch64.vpkg on Vega Virtual Device · verified'
    )
    expect(toast.closest('[role="status"]')?.textContent).toContain(`$ ${CLI}`)
    expect(within(steps).getByRole('listitem', { name: 'Following logs: done' })).toBeTruthy()
    await vi.waitFor(() => expect(run.disabled).toBe(false))
  })

  test('a batch while the target is offline: the TARGET_OFFLINE error toast', async () => {
    const stub = await renderApp({ mode: folder })
    const button = await toggle('Watch off')
    await vi.waitFor(() => expect(button.disabled).toBe(false))
    fireEvent.click(button)
    await toggle('Watching build/')

    act(() =>
      stub.pushWatch({
        kind: 'changed',
        change: {
          folder: '~/dev/player',
          changed: [build],
          error: {
            code: 'TARGET_OFFLINE',
            message: 'Vega Virtual Device is stopped',
            hint: 'Start it with ovd vvd start'
          }
        }
      })
    )
    expect(
      await screen.findByText('Vega Virtual Device is stopped. Start it with ovd vvd start')
    ).toBeTruthy()
    act(() =>
      stub.pushWatch({
        kind: 'changed',
        change: { folder: '~/dev/player', changed: [build], target }
      })
    )
    expect(
      await screen.findByText('Build folder changed · no build for Vega Virtual Device')
    ).toBeTruthy()
  })

  test('main ends the watch (another project opened elsewhere): off with an info toast', async () => {
    const stub = await renderApp({ mode: folder })
    const button = await toggle('Watch off')
    await vi.waitFor(() => expect(button.disabled).toBe(false))
    fireEvent.click(button)
    await toggle('Watching build/')

    act(() => {
      stub.pushWatch({ kind: 'state', watching: false })
      stub.pushWatch({ kind: 'stopped' })
    })
    expect(await toggle('Watch off')).toBeTruthy()
    expect(await screen.findByText('Watch off · another project was opened')).toBeTruthy()
  })

  test('opening another project here turns Watch off', async () => {
    const stub = await renderApp({
      mode: folder,
      open: async () => ({ ok: true, data: other })
    })
    const button = await toggle('Watch off')
    await vi.waitFor(() => expect(button.disabled).toBe(false))
    fireEvent.click(button)
    await toggle('Watching build/')

    await act(async () => {
      const file = new File(['x'], 'hellovega')
      fireEvent.drop(window, { dataTransfer: { files: [file], types: ['Files'] } })
    })
    await vi.waitFor(() => expect(stub.api.watch.set).toHaveBeenLastCalledWith(false))
    expect(await toggle('Watch off')).toBeTruthy()
  })
})
