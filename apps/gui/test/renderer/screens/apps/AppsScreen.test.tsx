import type {
  AppDetails,
  AppList,
  Device,
  InstalledApp,
  LaunchResult,
  PackageBuild,
  TerminateResult
} from '@ovd/core'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { IpcResult, OvdApi } from '../../../../src/preload/api'
import { DevicesProvider } from '../../../../src/renderer/src/devices/DevicesProvider'
import { FeedbackProvider } from '../../../../src/renderer/src/feedback/FeedbackProvider'
import { ToastViewport } from '../../../../src/renderer/src/feedback/ToastViewport'
import { StatusBar } from '../../../../src/renderer/src/frame/StatusBar'
import { AppsScreen } from '../../../../src/renderer/src/screens/apps/AppsScreen'
import { ready, stubOvd } from '../../support/ovdStub'
import { stick } from '../devices/sample'
import { hello, listFor, player } from './sample'

const both = listFor(stick.id, stick.name, [player, hello])

function stub(
  opts: {
    devices?: Device[]
    list?: OvdApi['apps']['list']
    info?: OvdApi['apps']['info']
    actions?: Partial<Omit<OvdApi['apps'], 'list' | 'info'>>
    resolve?: OvdApi['install']['resolve']
  } = {}
): OvdApi {
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
  }).api
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
const launchedHello: IpcResult<LaunchResult> = {
  ok: true,
  data: {
    target,
    app: {
      packageId: hello.packageId,
      title: hello.title,
      componentId: 'com.example.hellovega.main'
    },
    launched: true
  }
}
const stoppedPlayer: IpcResult<TerminateResult> = {
  ok: true,
  data: {
    target,
    app: { packageId: player.packageId, title: player.title },
    forced: false,
    wasRunning: true
  }
}
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

    expect(await screen.findByText('Launched Hello Vega')).toBeTruthy()
    expect(api.apps.launch).toHaveBeenCalledWith('com.example.hellovega', stick.id)
    expect(echoed()).toContain(`$ ovd apps launch com.example.hellovega --device ${stick.id}`)
    expect(detail('Sample Player')).toBeTruthy()
    await waitFor(() => expect(api.apps.list).toHaveBeenCalledTimes(2))
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
    expect(await screen.findByText('Launched Hello Vega')).toBeTruthy()

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
    expect(within(panel).getByText('clears app data (to be verified)')).toBeTruthy()
  })

  test('with a package, Uninstall & reinstall reinstalls', async () => {
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
              architecture: 'armv7'
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

    expect(await screen.findByText('Reinstalled Sample Player')).toBeTruthy()
    expect(api.apps.reinstall).toHaveBeenCalledWith('com.example.player', stick.id)
    expect(echoed()).toContain(`ovd apps reinstall com.example.player --device ${stick.id}`)
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
