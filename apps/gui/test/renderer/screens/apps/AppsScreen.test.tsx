import type {
  AppDetails,
  AppList,
  Device,
  InstalledApp,
  LaunchResult,
  PackageBuild,
  TerminateResult,
  UninstallResult
} from '@ovd/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { IpcResult, OvdApi } from '../../../../src/preload/api'
import { DevicesProvider } from '../../../../src/renderer/src/devices/DevicesProvider'
import { FeedbackProvider } from '../../../../src/renderer/src/feedback/FeedbackProvider'
import { ToastViewport } from '../../../../src/renderer/src/feedback/ToastViewport'
import { StatusBar } from '../../../../src/renderer/src/frame/StatusBar'
import { AppsScreen } from '../../../../src/renderer/src/screens/apps/AppsScreen'
import { resetLaunchOutcomes } from '../../../../src/renderer/src/screens/apps/launchOutcomes'
import { ready, stubOvd, type OvdStub } from '../../support/ovdStub'
import { stick, vvd } from '../devices/sample'
import { hello, listFor, player } from './sample'

const both = listFor(stick.id, stick.name, [player, hello])

// The launch outcomes are a session store shared by every render in this file.
afterEach(resetLaunchOutcomes)

interface StubOptions {
  devices?: Device[]
  list?: OvdApi['apps']['list']
  info?: OvdApi['apps']['info']
  actions?: Partial<Omit<OvdApi['apps'], 'list' | 'info'>>
  resolve?: OvdApi['install']['resolve']
}

// The whole stub, for tests that push device updates.
function stubAll(opts: StubOptions = {}): OvdStub {
  const devices = opts.devices ?? [stick]
  return stubOvd({
    list: async () => ready(devices, devices[0]?.id ?? null),
    devices,
    ...(opts.resolve ? { install: { resolve: opts.resolve } } : {}),
    apps: {
      ...opts.actions,
      list: opts.list ?? (async (): Promise<IpcResult<AppList>> => ({ ok: true, data: both })),
      info:
        opts.info ??
        (async (app: string): Promise<IpcResult<AppDetails>> => {
          const found = both.apps.find((a) => a.packageId === app) ?? player
          return {
            ok: true,
            data: {
              target: both.target,
              app: {
                ...found,
                components: found.components.map((c) => ({ ...c, type: 'interactive' }))
              }
            }
          }
        })
    }
  })
}

function stub(opts: StubOptions = {}): OvdApi {
  return stubAll(opts).api
}

function renderScreen(handlers: { onSwitchTarget?: () => void; onGoPackages?: () => void } = {}) {
  render(
    <FeedbackProvider>
      <DevicesProvider>
        <AppsScreen
          onSwitchTarget={handlers.onSwitchTarget ?? (() => {})}
          onGoPackages={handlers.onGoPackages ?? (() => {})}
          projectPath={null}
        />
      </DevicesProvider>
      <StatusBar />
      <ToastViewport />
    </FeedbackProvider>
  )
}

// The table row that shows an app's title.
async function row(title: string): Promise<HTMLElement> {
  const table = await screen.findByRole('table')
  await within(table).findByText(title)
  const found = within(table)
    .getAllByRole('row')
    .find((r) => within(r).queryByText(title) !== null)
  if (!found) throw new Error(`no row for ${title}`)
  return found
}

function detail(title: string): HTMLElement {
  return screen.getByRole('complementary', { name: `${title} details` })
}

// The confirmation dialog with that title. The panel keeps its own Uninstall button, so dialog
// buttons are queried within it.
function dialog(name: string): HTMLElement {
  return screen.getByRole('dialog', { name })
}

function echoed(): string {
  return screen.getByTitle('Copy CLI equivalent').textContent ?? ''
}

// A promise the test resolves when it wants the action to finish.
function pending<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const target = { id: stick.id, name: stick.name }
const helloApp = {
  packageId: hello.packageId,
  title: hello.title,
  componentId: 'com.example.hellovega.main'
}
const launchedHello: IpcResult<LaunchResult> = {
  ok: true,
  data: {
    target,
    app: {
      packageId: hello.packageId,
      title: hello.title,
      componentId: 'com.example.hellovega.main'
    },
    launched: true,
    wasRunning: false,
    verified: true,
    pid: 5120
  }
}
const helloCrash = {
  pid: 5120,
  time: '2026-11-05T14:02:00.000Z',
  signal: 'SIGABRT',
  language: 'JavaScript',
  message: 'Error: hello: deliberate crash right after launch',
  stack: ['at anonymous (index.bundle:652:20)'],
  logs: [
    "Nov 05 14:02:00.120 acr_core_dump[3811]: Process 'com.example.hellovega' (PID=5120) crashed with signal 6"
  ]
}
const crashedHello: IpcResult<LaunchResult> = {
  ok: true,
  data: {
    target,
    app: helloApp,
    launched: true,
    wasRunning: false,
    verified: false,
    reason: 'crashed',
    crash: helloCrash
  }
}
const CRASHED = 'Launch reported success, but the app crashed'
const stoppedPlayer: IpcResult<TerminateResult> = {
  ok: true,
  data: {
    target,
    app: { packageId: player.packageId, title: player.title },
    forced: false,
    wasRunning: true
  }
}
const uninstalled: IpcResult<UninstallResult> = {
  ok: true,
  data: {
    target,
    app: { packageId: player.packageId, title: player.title },
    uninstalled: true
  }
}
const UNINSTALL_ASK = `Uninstall Sample Player from ${stick.name}?`
const REINSTALL_ASK = `Uninstall & reinstall Sample Player on ${stick.name}?`
const found: IpcResult<Pick<PackageBuild, 'path' | 'displayPath' | 'file'>> = {
  ok: true,
  data: {
    path: '/home/dev/dev/player/build/armv7-release/player_armv7.vpkg',
    displayPath: '~/dev/player/build/armv7-release/player_armv7.vpkg',
    file: 'player_armv7.vpkg'
  }
}

describe('Apps screen', () => {
  test('lists the target’s apps with their status, and details the first', async () => {
    const api = stub()
    renderScreen()
    const table = await screen.findByRole('table')
    expect(within(table).getByText('Sample Player')).toBeTruthy()
    expect(within(table).getByText('Running · 4182')).toBeTruthy()
    expect(within(table).getByText('Stopped')).toBeTruthy()
    expect(
      screen.getByText(
        'On Fire TV stick · launches are verified against running-apps and crash history'
      )
    ).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Installed · 2' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Running · 1' })).toBeTruthy()
    expect(api.apps.list).toHaveBeenCalledWith(stick.id, false)

    const detail = screen.getByRole('complementary', { name: 'Sample Player details' })
    expect(within(detail).getByText('PERMANENT')).toBeTruthy()
    expect(within(detail).getByText('Components · vpm info / vlcm list')).toBeTruthy()
    // The component type comes from `vpm info`, read for the detail.
    expect(await within(detail).findByText('interactive')).toBeTruthy()
    expect(screen.getByText(`$ ovd apps --device ${stick.id}`)).toBeTruthy()
  })

  test('selecting an app details it and echoes ovd apps info', async () => {
    const api = stub()
    renderScreen()
    fireEvent.click(await screen.findByText('Hello Vega'))
    expect(await screen.findByRole('complementary', { name: 'Hello Vega details' })).toBeTruthy()
    expect(
      screen.getByText(`$ ovd apps info com.example.hellovega --device ${stick.id}`)
    ).toBeTruthy()
    expect(api.apps.info).toHaveBeenCalledWith('com.example.hellovega', stick.id)
  })

  test('the Running tab lists only running apps', async () => {
    stub()
    renderScreen()
    fireEvent.click(await screen.findByRole('tab', { name: 'Running · 1' }))
    const table = screen.getByRole('table')
    expect(within(table).getByText('Sample Player')).toBeTruthy()
    expect(within(table).queryByText('Hello Vega')).toBeNull()
  })

  test('nothing running', async () => {
    stub({ list: async () => ({ ok: true, data: listFor(stick.id, stick.name, [hello]) }) })
    renderScreen()
    // Wait for the list: before it arrives the tab also reads "Running · 0".
    await within(await screen.findByRole('table')).findByText('Hello Vega')
    fireEvent.click(screen.getByRole('tab', { name: 'Running · 0' }))
    expect(screen.getByText('Nothing running on this device.')).toBeTruthy()
  })

  test('nothing installed: points to Packages', async () => {
    stub({ list: async () => ({ ok: true, data: listFor(stick.id, stick.name, []) }) })
    const onGoPackages = vi.fn()
    renderScreen({ onGoPackages })
    expect(await screen.findByText('No apps you installed on Fire TV stick')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Go to Packages' }))
    expect(onGoPackages).toHaveBeenCalled()
  })

  test('a failed read shows the error and its hint', async () => {
    stub({
      list: async () => ({
        ok: false,
        error: { code: 'COMMAND_FAILED', message: 'Couldn’t read the running apps', hint: 'Retry' }
      })
    })
    renderScreen()
    expect(await screen.findByText('Couldn’t read the running apps')).toBeTruthy()
    expect(screen.getByText('Retry')).toBeTruthy()
  })

  test('an offline target: nothing is read', async () => {
    const api = stub({ devices: [{ ...stick, status: 'offline' }] })
    const onSwitchTarget = vi.fn()
    renderScreen({ onSwitchTarget })
    expect(await screen.findByText('Apps unavailable — Fire TV stick is offline')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Switch target' }))
    expect(onSwitchTarget).toHaveBeenCalled()
    expect(api.apps.list).not.toHaveBeenCalled()
  })

  test('no target', async () => {
    const api = stub({ devices: [] })
    renderScreen()
    expect(await screen.findByText('No target device')).toBeTruthy()
    expect(api.apps.list).not.toHaveBeenCalled()
  })

  test('reads again when the window regains focus', async () => {
    const api = stub()
    renderScreen()
    await screen.findByRole('table')
    fireEvent.focus(window)
    expect(api.apps.list).toHaveBeenCalledTimes(2)
  })
})

describe('Apps screen actions', () => {
  test('a row’s Launch launches that app, keeps the selection, toasts, echoes and reloads', async () => {
    const api = stub({ actions: { launch: async () => launchedHello } })
    renderScreen()

    fireEvent.click(within(await row('Hello Vega')).getByRole('button', { name: 'Launch' }))

    expect(await screen.findByText('Launched Hello Vega · verified')).toBeTruthy()
    expect(api.apps.launch).toHaveBeenCalledWith('com.example.hellovega', stick.id)
    expect(echoed()).toContain(`$ ovd apps launch com.example.hellovega --device ${stick.id}`)
    expect(detail('Sample Player')).toBeTruthy()
    await waitFor(() => expect(api.apps.list).toHaveBeenCalledTimes(2))
  })

  test('a row’s Launch on an app that already runs says so, and echoes', async () => {
    const api = stub({
      actions: {
        launch: async () => ({
          ok: true,
          data: {
            target,
            app: helloApp,
            launched: false,
            wasRunning: true,
            verified: true,
            pid: 5120
          }
        })
      }
    })
    renderScreen()

    fireEvent.click(within(await row('Hello Vega')).getByRole('button', { name: 'Launch' }))

    const toast = (await screen.findAllByRole('status')).find((t) =>
      t.textContent?.includes('Hello Vega is already running')
    )
    expect(toast?.textContent).toContain(
      `$ ovd apps launch com.example.hellovega --device ${stick.id}`
    )
    expect(screen.queryByText('Launched Hello Vega · verified')).toBeNull()
    expect(api.apps.launch).toHaveBeenCalledWith('com.example.hellovega', stick.id)
    expect(echoed()).toContain(`$ ovd apps launch com.example.hellovega --device ${stick.id}`)
  })

  test('a row’s Stop stops a running app gracefully', async () => {
    const api = stub({ actions: { terminate: async () => stoppedPlayer } })
    renderScreen()

    fireEvent.click(within(await row('Sample Player')).getByRole('button', { name: 'Stop' }))

    expect(await screen.findByText('Stopped Sample Player')).toBeTruthy()
    expect(api.apps.terminate).toHaveBeenCalledWith('com.example.player', stick.id, false)
  })

  test('a running app’s detail: Restart, Terminate, Force stop; Force stop forces', async () => {
    const api = stub({
      actions: {
        terminate: async () => ({
          ok: true,
          data: { ...stoppedPlayer.data, forced: true, wasRunning: null }
        })
      }
    })
    renderScreen()
    await row('Sample Player')
    const panel = detail('Sample Player')
    expect(within(panel).getByRole('button', { name: 'Restart' })).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Terminate' })).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Launch' })).toBeNull()

    fireEvent.click(within(panel).getByRole('button', { name: 'Force stop' }))

    expect(await screen.findByText('Force stopped Sample Player')).toBeTruthy()
    expect(api.apps.terminate).toHaveBeenCalledWith('com.example.player', stick.id, true)
    expect(echoed()).toContain(`ovd apps terminate com.example.player --force --device ${stick.id}`)
  })

  test('while a launch runs, its button is busy and the app’s other actions say why', async () => {
    const launch = pending<IpcResult<LaunchResult>>()
    stub({ actions: { launch: () => launch.promise } })
    renderScreen()
    fireEvent.click(await screen.findByText('Hello Vega'))
    const panel = await screen.findByRole('complementary', { name: 'Hello Vega details' })

    fireEvent.click(within(panel).getByRole('button', { name: 'Launch' }))

    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: 'Launch' }).getAttribute('aria-busy')).toBe(
        'true'
      )
    )
    const uninstall = within(panel).getByRole('button', { name: 'Uninstall' }) as HTMLButtonElement
    expect(uninstall.disabled).toBe(true)
    expect(uninstall.getAttribute('title')).toBe('Another action is running on this app')
    await act(async () => launch.resolve(launchedHello))
  })

  test('actions on two apps run side by side: finishing one leaves the other busy', async () => {
    const launch = pending<IpcResult<LaunchResult>>()
    const terminate = pending<IpcResult<TerminateResult>>()
    stub({ actions: { launch: () => launch.promise, terminate: () => terminate.promise } })
    renderScreen()

    fireEvent.click(within(await row('Hello Vega')).getByRole('button', { name: 'Launch' }))
    fireEvent.click(within(await row('Sample Player')).getByRole('button', { name: 'Stop' }))
    await act(async () => launch.resolve(launchedHello))
    expect(await screen.findByText('Launched Hello Vega · verified')).toBeTruthy()

    const stop = within(await row('Sample Player')).getByRole('button', { name: 'Stop' })
    expect(stop.getAttribute('aria-busy')).toBe('true')
    const restart = within(detail('Sample Player')).getByRole('button', {
      name: 'Restart'
    }) as HTMLButtonElement
    expect(restart.disabled).toBe(true)
    await act(async () => terminate.resolve(stoppedPlayer))
  })

  test('a failed action toasts the message and hint, and doesn’t reload', async () => {
    const api = stub({
      actions: {
        launch: async () => ({
          ok: false,
          error: {
            code: 'LAUNCH_FAILED',
            message: 'Launch failed: boom',
            hint: 'Check the app with ovd apps info, then retry'
          }
        })
      }
    })
    renderScreen()

    fireEvent.click(within(await row('Hello Vega')).getByRole('button', { name: 'Launch' }))

    expect(
      await screen.findByText('Launch failed: boom. Check the app with ovd apps info, then retry')
    ).toBeTruthy()
    expect(api.apps.list).toHaveBeenCalledTimes(1)
  })

  test('Uninstall & reinstall is disabled with the reason when there is no package', async () => {
    stub()
    renderScreen()
    await row('Sample Player')
    const panel = detail('Sample Player')

    const button = (await within(panel).findByRole('button', {
      name: 'Uninstall & reinstall'
    })) as HTMLButtonElement
    await waitFor(() =>
      expect(button.getAttribute('title')).toBe('No package for com.example.player')
    )
    expect(button.disabled).toBe(true)
    expect(within(panel).getByText('clears app data')).toBeTruthy()
  })

  test('with a package, Uninstall & reinstall asks, then reinstalls', async () => {
    const api = stub({
      resolve: async () => found,
      actions: {
        reinstall: async () => ({
          ok: true,
          data: {
            target: { ...target, architecture: 'armv7' },
            app: { packageId: player.packageId, title: player.title },
            uninstalled: true,
            package: {
              ...found.data,
              id: player.packageId,
              title: player.title,
              version: '1.4.2',
              buildNumber: 142,
              architecture: 'armv7',
              buildType: 'release'
            },
            forced: false
          }
        })
      }
    })
    renderScreen()
    await row('Sample Player')
    const panel = detail('Sample Player')
    const button = within(panel).getByRole('button', {
      name: 'Uninstall & reinstall'
    }) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false))

    fireEvent.click(button)

    const ask = dialog(REINSTALL_ASK)
    expect(
      within(ask).getByText('Its app data is removed, then the build is installed again.')
    ).toBeTruthy()
    expect(api.apps.reinstall).not.toHaveBeenCalled()
    fireEvent.click(within(ask).getByRole('button', { name: 'Uninstall & reinstall' }))

    expect(await screen.findByText('Reinstalled Sample Player')).toBeTruthy()
    expect(api.apps.reinstall).toHaveBeenCalledWith('com.example.player', stick.id)
    expect(echoed()).toContain(`ovd apps reinstall com.example.player --device ${stick.id}`)
  })

  test('Uninstall asks first: the dialog names the app and the target, Cancel has focus', async () => {
    const api = stub()
    renderScreen()
    await row('Sample Player')

    fireEvent.click(within(detail('Sample Player')).getByRole('button', { name: 'Uninstall' }))

    const ask = dialog(UNINSTALL_ASK)
    expect(within(ask).getByText('Its app data is removed.')).toBeTruthy()
    expect(within(ask).getByText('com.example.player')).toBeTruthy()
    expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Cancel' }))
    expect(api.apps.uninstall).not.toHaveBeenCalled()
  })

  test.each([['Cancel'], ['Close'], ['Esc']])(
    'closing the Uninstall dialog with %s runs nothing',
    async (how) => {
      const api = stub()
      renderScreen()
      await row('Sample Player')
      const before = echoed()
      const lists = vi.mocked(api.apps.list).mock.calls.length

      fireEvent.click(within(detail('Sample Player')).getByRole('button', { name: 'Uninstall' }))
      const ask = dialog(UNINSTALL_ASK)
      if (how === 'Esc') fireEvent.keyDown(window, { key: 'Escape' })
      else fireEvent.click(within(ask).getByRole('button', { name: how }))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(api.apps.uninstall).not.toHaveBeenCalled()
      expect(echoed()).toBe(before)
      expect(screen.queryByText('Uninstalled Sample Player')).toBeNull()
      expect(
        within(detail('Sample Player'))
          .getByRole('button', { name: 'Uninstall' })
          .getAttribute('aria-busy')
      ).toBeNull()
      expect(api.apps.list).toHaveBeenCalledTimes(lists)
    }
  )

  test('confirming Uninstall uninstalls, echoes, toasts and reloads', async () => {
    const api = stub({ actions: { uninstall: async () => uninstalled } })
    renderScreen()
    await row('Sample Player')

    fireEvent.click(within(detail('Sample Player')).getByRole('button', { name: 'Uninstall' }))
    fireEvent.click(within(dialog(UNINSTALL_ASK)).getByRole('button', { name: 'Uninstall' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText('Uninstalled Sample Player')).toBeTruthy()
    expect(api.apps.uninstall).toHaveBeenCalledWith('com.example.player', stick.id)
    expect(echoed()).toContain(`ovd apps uninstall com.example.player --device ${stick.id}`)
    await waitFor(() => expect(api.apps.list).toHaveBeenCalledTimes(2))
  })

  test('cancelling Uninstall & reinstall runs nothing', async () => {
    const api = stub({ resolve: async () => found })
    renderScreen()
    await row('Sample Player')
    const button = within(detail('Sample Player')).getByRole('button', {
      name: 'Uninstall & reinstall'
    }) as HTMLButtonElement
    await waitFor(() => expect(button.disabled).toBe(false))

    fireEvent.click(button)

    const ask = dialog(REINSTALL_ASK)
    expect(
      within(ask).getByText('Its app data is removed, then the build is installed again.')
    ).toBeTruthy()
    const cancel = within(ask).getByRole('button', { name: 'Cancel' })
    expect(document.activeElement).toBe(cancel)
    fireEvent.click(cancel)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.apps.reinstall).not.toHaveBeenCalled()
  })

  test('a target change while the dialog is open closes it for good', async () => {
    const devices = [stick, { ...vvd, status: 'online' as const }]
    const { api, push } = stubAll({ devices })
    renderScreen()
    await row('Sample Player')
    fireEvent.click(within(detail('Sample Player')).getByRole('button', { name: 'Uninstall' }))
    expect(dialog(UNINSTALL_ASK)).toBeTruthy()

    act(() => push(ready(devices, vvd.id)))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // Back on the stick, the dialog doesn't come back.
    act(() => push(ready(devices, stick.id)))
    await row('Sample Player')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.apps.uninstall).not.toHaveBeenCalled()
  })

  test('the app leaving the list while the dialog is open closes it', async () => {
    let listed = [player, hello]
    const api = stub({
      list: async () => ({ ok: true, data: listFor(stick.id, stick.name, listed) })
    })
    renderScreen()
    await row('Sample Player')
    fireEvent.click(within(detail('Sample Player')).getByRole('button', { name: 'Uninstall' }))
    expect(dialog(UNINSTALL_ASK)).toBeTruthy()

    listed = [hello]
    fireEvent.focus(window)

    await waitFor(() => {
      expect(api.apps.list).toHaveBeenCalledTimes(2)
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(api.apps.uninstall).not.toHaveBeenCalled()
  })

  test('a package built since the last read is found after the list reloads', async () => {
    let built = false
    stub({
      // A fresh list per read, as IPC delivers it.
      list: async () => ({ ok: true, data: listFor(stick.id, stick.name, [player, hello]) }),
      resolve: async (app) =>
        built
          ? found
          : {
              ok: false,
              error: { code: 'NO_PACKAGE', message: `No package for ${app}`, hint: '' }
            }
    })
    renderScreen()
    await row('Sample Player')
    const button = within(detail('Sample Player')).getByRole('button', {
      name: 'Uninstall & reinstall'
    }) as HTMLButtonElement
    await waitFor(() =>
      expect(button.getAttribute('title')).toBe('No package for com.example.player')
    )

    built = true
    fireEvent.focus(window)

    await waitFor(() => expect(button.disabled).toBe(false))
  })

  test('an Appstore app has no uninstall actions', async () => {
    const store: InstalledApp = { ...hello, source: 'store' }
    stub({ list: async () => ({ ok: true, data: listFor(stick.id, stick.name, [store]) }) })
    renderScreen()
    await row('Hello Vega')
    const panel = detail('Hello Vega')
    expect(within(panel).getByRole('button', { name: 'Launch' })).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Uninstall' })).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'Uninstall & reinstall' })).toBeNull()
  })

  test('after a launch, the reloaded list updates the Running tab and the detail', async () => {
    const helloRunning: InstalledApp = {
      ...hello,
      status: { state: 'running', pid: 5120, lifespan: 'PERMANENT' },
      components: [
        {
          id: 'com.example.hellovega.main',
          running: {
            pid: 5120,
            state: 'VISIBLE',
            lifespan: 'PERMANENT',
            container: 'framework.slice/essential/5120'
          }
        }
      ]
    }
    let launched = false
    stub({
      list: async () => ({
        ok: true,
        data: listFor(stick.id, stick.name, [player, launched ? helloRunning : hello])
      }),
      actions: {
        launch: async () => {
          launched = true
          return launchedHello
        }
      }
    })
    renderScreen()
    fireEvent.click(await screen.findByText('Hello Vega'))
    const panel = await screen.findByRole('complementary', { name: 'Hello Vega details' })
    // The cached detail is read before the launch.
    await within(panel).findByText('interactive')

    fireEvent.click(within(panel).getByRole('button', { name: 'Launch' }))

    expect(await screen.findByRole('tab', { name: 'Running · 2' })).toBeTruthy()
    const after = detail('Hello Vega')
    expect(within(after).getByRole('button', { name: 'Restart' })).toBeTruthy()
    expect(within(after).queryByRole('button', { name: 'Launch' })).toBeNull()
  })
})

describe('Apps screen launch verification', () => {
  async function launchHello(): Promise<HTMLElement> {
    fireEvent.click(await screen.findByText('Hello Vega'))
    const panel = await screen.findByRole('complementary', { name: 'Hello Vega details' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Launch' }))
    return panel
  }

  test('while a launch is verified: Verifying… in the row and the detail', async () => {
    const launch = pending<IpcResult<LaunchResult>>()
    stub({ actions: { launch: () => launch.promise } })
    renderScreen()

    const panel = await launchHello()

    expect(await within(await row('Hello Vega')).findByText('Verifying…')).toBeTruthy()
    expect(within(panel).getByText('Verifying launch…')).toBeTruthy()
    expect(within(panel).getByText('Verifying…')).toBeTruthy()
    await act(async () => launch.resolve(launchedHello))
    expect(await screen.findByText('Launched Hello Vega · verified')).toBeTruthy()
    expect(within(await row('Hello Vega')).queryByText('Verifying…')).toBeNull()
  })

  test('a crash: Crashed on launch, the callout with its cause and logs, an error toast', async () => {
    stub({ actions: { launch: async () => crashedHello } })
    renderScreen()

    const panel = await launchHello()

    expect(await within(await row('Hello Vega')).findByText('Crashed on launch')).toBeTruthy()
    expect(within(panel).getByText('Crashed on launch')).toBeTruthy()
    const callout = within(panel).getByRole('alert')
    expect(within(callout).getByText(CRASHED)).toBeTruthy()
    expect(callout.textContent).toContain(
      'SIGABRT · Error: hello: deliberate crash right after launch'
    )
    expect(callout.textContent).toContain('pid 5120')
    const toast = (await screen.findAllByRole('status')).find((t) =>
      t.textContent?.includes(CRASHED)
    )
    expect(toast?.textContent).toContain(
      `$ ovd apps launch com.example.hellovega --device ${stick.id}`
    )
    expect(echoed()).toContain(`$ ovd apps launch com.example.hellovega --device ${stick.id}`)

    const logs = within(callout).getByRole('button', { name: 'Logs around crash' })
    expect(logs.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(logs)
    expect(logs.getAttribute('aria-expanded')).toBe('true')
    expect(within(callout).getByText(/crashed with signal 6/)).toBeTruthy()
  })

  test('a crash without logs says so', async () => {
    stub({
      actions: {
        launch: async () =>
          crashedHello.ok
            ? { ok: true, data: { ...crashedHello.data, crash: { ...helloCrash, logs: [] } } }
            : crashedHello
      }
    })
    renderScreen()

    const panel = await launchHello()

    fireEvent.click(await within(panel).findByRole('button', { name: 'Logs around crash' }))
    expect(within(panel).getByText('No log lines were captured')).toBeTruthy()
  })

  test('not running after launch: the callout and an error toast, the status stays Stopped', async () => {
    stub({
      actions: {
        launch: async () => ({
          ok: true,
          data: {
            target,
            app: helloApp,
            launched: true,
            wasRunning: false,
            verified: false,
            reason: 'not-running'
          }
        })
      }
    })
    renderScreen()

    const panel = await launchHello()

    const callout = await within(panel).findByRole('alert')
    expect(
      within(callout).getByText('Launch reported success, but the app isn’t running')
    ).toBeTruthy()
    expect(
      (await screen.findAllByRole('status')).some((t) =>
        t.textContent?.includes('Launch reported success, but the app isn’t running')
      )
    ).toBe(true)
    expect(within(await row('Hello Vega')).getByText('Stopped')).toBeTruthy()
  })

  test('Crashed on launch survives leaving the screen and coming back', async () => {
    stub({ actions: { launch: async () => crashedHello } })
    renderScreen()
    await launchHello()
    expect(await within(await row('Hello Vega')).findByText('Crashed on launch')).toBeTruthy()

    cleanup()
    renderScreen()

    expect(await within(await row('Hello Vega')).findByText('Crashed on launch')).toBeTruthy()
  })

  test('the next action on the app clears it', async () => {
    let calls = 0
    stub({
      actions: {
        launch: async () => {
          calls += 1
          return calls === 1 ? crashedHello : launchedHello
        }
      }
    })
    renderScreen()
    const panel = await launchHello()
    expect(await within(panel).findByText('Crashed on launch')).toBeTruthy()

    fireEvent.click(within(panel).getByRole('button', { name: 'Launch' }))

    expect(await screen.findByText('Launched Hello Vega · verified')).toBeTruthy()
    expect(within(await row('Hello Vega')).queryByText('Crashed on launch')).toBeNull()
    expect(within(panel).queryByRole('alert')).toBeNull()
  })

  test('a reload that lists the app running clears it', async () => {
    const helloRunning: InstalledApp = {
      ...hello,
      status: { state: 'running', pid: 5130, lifespan: 'PERMANENT' }
    }
    let up = false
    stub({
      list: async () => ({
        ok: true,
        data: listFor(stick.id, stick.name, [player, up ? helloRunning : hello])
      }),
      actions: { launch: async () => crashedHello }
    })
    renderScreen()
    await launchHello()
    expect(await within(await row('Hello Vega')).findByText('Crashed on launch')).toBeTruthy()

    up = true
    fireEvent.focus(window)

    expect(await within(await row('Hello Vega')).findByText('Running · 5130')).toBeTruthy()
    expect(within(await row('Hello Vega')).queryByText('Crashed on launch')).toBeNull()
  })
})
