import type { Device, VvdState } from '@ovd/core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { IpcResult, OvdApi } from '../../../../src/preload/api'
import { App } from '../../../../src/renderer/src/App'
import { FeedbackProvider } from '../../../../src/renderer/src/feedback/FeedbackProvider'
import { ready, stubOvd } from '../../support/ovdStub'
import { stick, vvd } from './sample'

const vvdOnline: Device = {
  ...vvd,
  vdaSerial: 'emulator-5554',
  status: 'online',
  info: {
    os: 'OS 1.2',
    build: 'TV Ship/102282480',
    architecture: 'aarch64',
    profile: 'tv',
    product: 'vvrp-tv-arm64',
    simulated: true,
    developerMode: true,
    raw: { architecture: 'aarch64' }
  }
}
const devmodeOff: Device = {
  ...vvdOnline,
  info: { ...(vvdOnline.info as NonNullable<Device['info']>), developerMode: false }
}

type Pending<T> = { promise: Promise<T>; resolve: (value: T) => void }
function pending<T>(): Pending<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const started: IpcResult<VvdState> = {
  ok: true,
  data: { running: true, status: 'online', device: vvdOnline }
}
const failed = (code: 'VVD_START_FAILED' | 'VVD_STOP_FAILED' | 'VVD_DEVMODE_FAILED') => ({
  ok: false as const,
  error: { code, message: 'failed', hint: 'hint' }
})

function renderWith(devices: Device[], vvdApi: Partial<OvdApi['vvd']>): OvdApi {
  const { api } = stubOvd({ list: async () => ready(devices, stick.id), devices, vvd: vvdApi })
  render(
    <FeedbackProvider>
      <App />
    </FeedbackProvider>
  )
  return api
}

async function openVvd(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: /Vega Virtual Device/ }))
  return screen.getByRole('list', { name: 'Devices' })
}

describe('Virtual Device start / stop', () => {
  test('the stopped card starts it; the button and status show progress, then a toast', async () => {
    const start = pending<IpcResult<VvdState>>()
    const api = renderWith([stick, vvd], { start: () => start.promise })
    const list = await openVvd()
    expect(screen.getByText('The Virtual Device is stopped.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start Virtual Device' }))
    expect(api.vvd.start).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeTruthy()
    expect(within(list).getByText('Starting…')).toBeTruthy()
    expect(screen.queryByText('The Virtual Device is stopped.')).toBeNull()
    // A second click while starting does nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Starting…' }))
    expect(api.vvd.start).toHaveBeenCalledTimes(1)
    await act(async () => start.resolve(started))
    expect(screen.getByText('Virtual Device started')).toBeTruthy()
    expect(screen.getAllByText(/ovd vvd start/).length).toBeGreaterThan(0)
  })

  test('the header Start button starts it too', async () => {
    const api = renderWith([stick, vvd], { start: async () => started })
    await openVvd()
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(api.vvd.start).toHaveBeenCalled()
    expect(await screen.findByText('Virtual Device started')).toBeTruthy()
  })

  test('a failed start toasts with Retry', async () => {
    const api = renderWith([stick, vvd], { start: async () => failed('VVD_START_FAILED') })
    await openVvd()
    fireEvent.click(screen.getByRole('button', { name: 'Start Virtual Device' }))
    expect(
      await screen.findByText(
        'Virtual Device didn’t start. Run ovd vvd start in a terminal to see why.'
      )
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(api.vvd.start).toHaveBeenCalledTimes(2)
  })

  test('Stop on a running Virtual Device shows Stopping…, then a toast', async () => {
    const stop = pending<IpcResult<VvdState>>()
    const api = renderWith([stick, vvdOnline], { stop: () => stop.promise })
    const list = await openVvd()
    expect(screen.getByRole('button', { name: 'Use as target' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(api.vvd.stop).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBeTruthy()
    expect(within(list).getByText('Stopping…')).toBeTruthy()
    // Not a usable target while it stops.
    expect(screen.queryByRole('button', { name: 'Use as target' })).toBeNull()
    await act(async () =>
      stop.resolve({ ok: true, data: { running: false, status: 'stopped', device: vvd } })
    )
    expect(screen.getByText('Virtual Device stopped')).toBeTruthy()
  })

  test('a failed stop toasts with Retry', async () => {
    renderWith([stick, vvdOnline], { stop: async () => failed('VVD_STOP_FAILED') })
    await openVvd()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(
      await screen.findByText(
        'Virtual Device didn’t stop. Run ovd vvd stop in a terminal to see why.'
      )
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  test('the empty state starts the Virtual Device', async () => {
    const api = renderWith([], { start: async () => started })
    expect(await screen.findByText('No devices yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start the Virtual Device' }))
    expect(api.vvd.start).toHaveBeenCalled()
  })
})

describe('Virtual Device Developer Mode', () => {
  test('off: the card enables it', async () => {
    const enable = pending<IpcResult<{ developerMode: true }>>()
    const api = renderWith([stick, devmodeOff], { enableDeveloperMode: () => enable.promise })
    await openVvd()
    expect(screen.getByText('Developer Mode is off on the Virtual Device.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Enable Developer Mode' }))
    expect(api.vvd.enableDeveloperMode).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Enabling…' })).toBeTruthy()
    await act(async () => enable.resolve({ ok: true, data: { developerMode: true } }))
    expect(screen.getByText('Developer Mode on')).toBeTruthy()
    expect(screen.getAllByText(/ovd vvd devmode enable/).length).toBeGreaterThan(0)
  })

  test('a failure toasts with Retry', async () => {
    const api = renderWith([stick, devmodeOff], {
      enableDeveloperMode: async () => failed('VVD_DEVMODE_FAILED')
    })
    await openVvd()
    fireEvent.click(screen.getByRole('button', { name: 'Enable Developer Mode' }))
    expect(
      await screen.findByText(
        'Developer Mode didn’t turn on. Try again; if it keeps failing, restart the Virtual Device.'
      )
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(api.vvd.enableDeveloperMode).toHaveBeenCalledTimes(2)
  })

  test('on: no card', async () => {
    renderWith([stick, vvdOnline], {})
    await openVvd()
    expect(screen.queryByText('Developer Mode is off on the Virtual Device.')).toBeNull()
  })
})
