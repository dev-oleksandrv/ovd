import type { Device } from '@ovd/core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { IpcResult, OvdApi } from '../../../src/preload/api'
import { App } from '../../../src/renderer/src/App'
import { FeedbackProvider } from '../../../src/renderer/src/feedback/FeedbackProvider'
import { ready, stubOvd } from '../support/ovdStub'
import { stick, vvd, wifiOffline } from '../screens/devices/sample'

const paired: Device = {
  ...stick,
  id: '192.0.2.42:5555',
  vdaSerial: '192.0.2.42:5555',
  connection: 'wifi',
  ip: '192.0.2.42',
  saved: true,
  isTarget: false
}

type Pending<T> = { promise: Promise<T>; resolve: (value: T) => void }
function pending<T>(): Pending<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const failed = (code: string, message: string, hint: string) => ({
  ok: false as const,
  error: { code, message, hint } as never
})

function renderWith(pairing: Partial<OvdApi['pairing']>, devices: Device[] = [stick, vvd]) {
  const { api } = stubOvd({ list: async () => ready(devices, stick.id), devices, pairing })
  render(
    <FeedbackProvider>
      <App />
    </FeedbackProvider>
  )
  return api
}

async function openWizard(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: 'Pair over Wi‑Fi' }))
  return screen.getByRole('dialog', { name: 'Pair a device over Wi-Fi' })
}

const click = (name: string): void => {
  fireEvent.click(screen.getByRole('button', { name }))
}

describe('Pair wizard', () => {
  test('with USB: one action pairs the stick, then Paired shows it', async () => {
    const run = pending<IpcResult<Device>>()
    const api = renderWith({ pairUsb: () => run.promise })
    const dialog = await openWizard()
    expect(within(dialog).getByText('Step 1 of 4')).toBeTruthy()
    expect(
      within(dialog)
        .getByRole('radio', { name: /With USB/ })
        .getAttribute('aria-checked')
    ).toBe('true')
    click('Next')
    expect(within(dialog).getByText('Switch the stick to TCP/IP')).toBeTruthy()
    expect(within(dialog).getByText('vega exec vda tcpip 5555')).toBeTruthy()
    click('Run & continue')
    expect(api.pairing.pairUsb).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText(/ovd pair --usb/).length).toBeGreaterThan(0)
    await act(async () => run.resolve({ ok: true, data: paired }))
    expect(within(dialog).getByText('Step 4 of 4')).toBeTruthy()
    expect(within(dialog).getByText('Paired')).toBeTruthy()
    expect(within(dialog).getByText('192.0.2.42:5555 · Wi-Fi · armv7')).toBeTruthy()
    expect(within(dialog).getByText('Serial G070000000000001')).toBeTruthy()
    click('Done')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Device paired over Wi-Fi')).toBeTruthy()
  })

  test('without USB: the address step validates the port, then connects', async () => {
    const api = renderWith({ pair: async () => ({ ok: true, data: paired }) })
    const dialog = await openWizard()
    fireEvent.click(within(dialog).getByRole('radio', { name: /Without USB/ }))
    click('Next')
    expect(within(dialog).getByText('Turn on TCP/IP on the TV')).toBeTruthy()
    click('The TV has rebooted')
    expect(within(dialog).getByText('Connect by IP address')).toBeTruthy()
    // No IP yet: Connect does nothing.
    click('Connect')
    expect(api.pairing.pair).not.toHaveBeenCalled()
    fireEvent.change(within(dialog).getByLabelText('IP address'), {
      target: { value: '192.0.2.42' }
    })
    fireEvent.change(within(dialog).getByLabelText('Port'), { target: { value: '80' } })
    expect(within(dialog).getByText('Port must be a number above 1024.')).toBeTruthy()
    click('Connect')
    expect(api.pairing.pair).not.toHaveBeenCalled()
    fireEvent.change(within(dialog).getByLabelText('Port'), { target: { value: '5555' } })
    expect(within(dialog).getByText('vega exec vda connect 192.0.2.42:5555')).toBeTruthy()
    click('Connect')
    expect(api.pairing.pair).toHaveBeenCalledWith('192.0.2.42:5555')
    expect(await within(dialog).findByText('Paired')).toBeTruthy()
  })

  test.each([
    [
      'DIFFERENT_NETWORK',
      'This computer is on 198.51.100.0/24, but 192.0.2.42 is on another network',
      'Connect both to the same Wi‑Fi, then retry',
      'Device and computer are on different networks'
    ],
    [
      'PAIR_TIMEOUT',
      '192.0.2.42:5555 didn’t answer',
      'Check the stick is on',
      'Port 5555 looks blocked'
    ]
  ])('%s shows its error and Retry connects again', async (code, message, hint, title) => {
    let calls = 0
    const api = renderWith({
      pair: async () => (++calls === 1 ? failed(code, message, hint) : { ok: true, data: paired })
    })
    const dialog = await openWizard()
    fireEvent.click(within(dialog).getByRole('radio', { name: /Without USB/ }))
    click('Next')
    click('The TV has rebooted')
    fireEvent.change(within(dialog).getByLabelText('IP address'), {
      target: { value: '192.0.2.42' }
    })
    click('Connect')
    const alert = await within(dialog).findByRole('alert')
    expect(within(alert).getByText(title)).toBeTruthy()
    click('Retry')
    expect(api.pairing.pair).toHaveBeenCalledTimes(2)
    expect(await within(dialog).findByText('Paired')).toBeTruthy()
  })

  test('opens from the target picker and the palette', async () => {
    renderWith({})
    fireEvent.click(await screen.findByRole('button', { name: 'Target device' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Pair a device over Wi‑Fi/ }))
    expect(screen.getByRole('dialog', { name: 'Pair a device over Wi-Fi' })).toBeTruthy()
    click('Cancel')
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    fireEvent.click(screen.getByRole('option', { name: /Pair a device over Wi‑Fi/ }))
    expect(screen.getByRole('dialog', { name: 'Pair a device over Wi-Fi' })).toBeTruthy()
  })
})

describe('saved Wi‑Fi device', () => {
  async function openSaved(): Promise<void> {
    fireEvent.click(await screen.findByRole('button', { name: /Bedroom stick/ }))
  }

  test('Reconnect shows progress, then a toast', async () => {
    const run = pending<IpcResult<Device>>()
    const api = renderWith({ connect: () => run.promise }, [stick, wifiOffline])
    await openSaved()
    click('Reconnect')
    expect(api.pairing.connect).toHaveBeenCalledWith('192.0.2.77:5555')
    expect(screen.getByRole('button', { name: 'Reconnecting…' })).toBeTruthy()
    expect(screen.getByText('Reconnecting Bedroom stick…')).toBeTruthy()
    await act(async () => run.resolve({ ok: true, data: { ...wifiOffline, status: 'online' } }))
    expect(screen.getByText('Bedroom stick is back online')).toBeTruthy()
  })

  test('a failed Reconnect toasts with Retry', async () => {
    const api = renderWith(
      { connect: async () => failed('PAIR_TIMEOUT', 'No answer', 'Check the stick is on') },
      [stick, wifiOffline]
    )
    await openSaved()
    click('Reconnect')
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(api.pairing.connect).toHaveBeenCalledTimes(2)
  })

  test('Forget asks first, then forgets', async () => {
    const api = renderWith(
      { forget: async () => ({ ok: true, data: { id: wifiOffline.id, switchedToUsb: false } }) },
      [stick, wifiOffline]
    )
    await openSaved()
    click('Forget')
    expect(
      screen.getByText('Forget Bedroom stick? It switches back to USB; pair it again to use Wi‑Fi.')
    ).toBeTruthy()
    click('Cancel')
    expect(api.pairing.forget).not.toHaveBeenCalled()
    click('Forget')
    const confirm = screen.getAllByRole('button', { name: 'Forget' }).at(-1)
    fireEvent.click(confirm as HTMLElement)
    expect(api.pairing.forget).toHaveBeenCalledWith('192.0.2.77:5555')
    expect(await screen.findByText(/Forgot Bedroom stick\. It stays in TCP\/IP mode/)).toBeTruthy()
  })

  test('an online device has no Reconnect or Forget', async () => {
    renderWith({}, [stick, wifiOffline])
    await screen.findByText('TV Ship/529')
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull()
  })
})
