import type { Device, RebootResult } from '@ovd/core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { IpcResult, OvdApi } from '../../../../src/preload/api'
import { App } from '../../../../src/renderer/src/App'
import { FeedbackProvider } from '../../../../src/renderer/src/feedback/FeedbackProvider'
import { ready, stubOvd } from '../../support/ovdStub'
import { stick, vvd, wifiOffline } from './sample'

const vvdOnline: Device = { ...vvd, vdaSerial: 'emulator-5554', status: 'online' }
const back: IpcResult<RebootResult> = {
  ok: true,
  data: {
    target: { id: 'VirtualDevice', name: 'Vega Virtual Device' },
    seconds: 16,
    reconnected: false
  }
}
const timedOut: IpcResult<RebootResult> = {
  ok: false,
  error: {
    code: 'REBOOT_TIMEOUT',
    message: 'Vega Virtual Device didn’t come back within 120 s',
    hint: 'Restart it with ovd vvd stop, then ovd vvd start'
  }
}

function pending<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

function renderWith(devices: Device[], reboot: OvdApi['devices']['reboot']): OvdApi {
  const { api } = stubOvd({ list: async () => ready(devices, stick.id), devices, reboot })
  render(
    <FeedbackProvider>
      <App />
    </FeedbackProvider>
  )
  return api
}

async function open(name: RegExp): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name }))
  return screen.getByRole('list', { name: 'Devices' })
}

describe('Reboot & wait', () => {
  test('shows Rebooting… and the callout while it waits, echoes, then toasts back online', async () => {
    const run = pending<IpcResult<RebootResult>>()
    const api = renderWith([stick, vvdOnline], () => run.promise)
    const list = await open(/Vega Virtual Device/)
    fireEvent.click(screen.getByRole('button', { name: 'Reboot & wait' }))
    expect(api.devices.reboot).toHaveBeenCalledWith('VirtualDevice')
    expect(screen.getByRole('button', { name: 'Rebooting…' })).toBeTruthy()
    expect(within(list).getByText('Rebooting…')).toBeTruthy()
    expect(
      screen.getByText('Rebooting Vega Virtual Device… OVD waits until it’s back online.')
    ).toBeTruthy()
    expect(screen.getAllByText(/ovd reboot --device VirtualDevice/).length).toBeGreaterThan(0)
    // Not a usable target while it reboots, and a second click does nothing.
    expect(screen.queryByRole('button', { name: 'Use as target' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Rebooting…' }))
    expect(api.devices.reboot).toHaveBeenCalledTimes(1)
    await act(async () => run.resolve(back))
    expect(screen.getByText('Vega Virtual Device is back online · 16 s')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reboot & wait' })).toBeTruthy()
    expect(screen.queryByText(/OVD waits until it’s back online/)).toBeNull()
  })

  test('a timeout toasts the error with Retry', async () => {
    const api = renderWith([stick, vvdOnline], async () => timedOut)
    await open(/Vega Virtual Device/)
    fireEvent.click(screen.getByRole('button', { name: 'Reboot & wait' }))
    expect(
      await screen.findByText(
        'Vega Virtual Device didn’t come back within 120 s. Restart it with ovd vvd stop, then ovd vvd start'
      )
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(api.devices.reboot).toHaveBeenCalledTimes(2)
  })

  test('a stick reboots too', async () => {
    const api = renderWith([stick, vvd], async () => back)
    await screen.findByText('TV Ship/529')
    fireEvent.click(screen.getByRole('button', { name: 'Reboot & wait' }))
    expect(api.devices.reboot).toHaveBeenCalledWith(stick.id)
  })

  test('not offered for a stopped Virtual Device or an offline stick', async () => {
    renderWith([stick, vvd, wifiOffline], async () => back)
    await open(/Vega Virtual Device/)
    expect(screen.queryByRole('button', { name: 'Reboot & wait' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Bedroom stick/ }))
    expect(screen.queryByRole('button', { name: 'Reboot & wait' })).toBeNull()
  })
})
