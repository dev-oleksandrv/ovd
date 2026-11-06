import type { AppDetails, AppList, Device } from '@ovd/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { IpcResult, OvdApi } from '../../../../src/preload/api'
import { DevicesProvider } from '../../../../src/renderer/src/devices/DevicesProvider'
import { FeedbackProvider } from '../../../../src/renderer/src/feedback/FeedbackProvider'
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
  } = {}
): OvdApi {
  const devices = opts.devices ?? [stick]
  return stubOvd({
    list: async () => ready(devices, devices[0]?.id ?? null),
    devices,
    apps: {
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
        />
      </DevicesProvider>
      <StatusBar />
    </FeedbackProvider>
  )
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
