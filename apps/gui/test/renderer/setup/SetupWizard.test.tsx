import type { Device, EnableResult } from '@ovd/core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { IpcResult, OvdApi } from '../../../src/preload/api'
import { App } from '../../../src/renderer/src/App'
import { FeedbackProvider } from '../../../src/renderer/src/feedback/FeedbackProvider'
import { doctorReport, ready, stubOvd, type OvdStub } from '../support/ovdStub'
import { stick, vvd } from '../screens/devices/sample'

type Pending<T> = { promise: Promise<T>; resolve: (value: T) => void }
function pending<T>(): Pending<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const failed = (code: string, message = `failed: ${code}`, hint = `hint for ${code}`) => ({
  ok: false as const,
  error: { code, message, hint } as never
})

const enabled: IpcResult<EnableResult> = {
  ok: true,
  data: { enabled: true, command: 'vega devmode enable-device --code ABC123' }
}
const prompt = {
  verificationUri: 'https://amazon.com/us/code?cbl-code=ABC123',
  userCode: 'XYZ789'
}

function renderWith(
  setup: Partial<Omit<OvdApi['setup'], 'onLoginPrompt'>>,
  devices: Device[] = [stick, vvd],
  pairing: Partial<OvdApi['pairing']> = {}
): OvdStub {
  const stub = stubOvd({ list: async () => ready(devices, stick.id), devices, setup, pairing })
  render(
    <FeedbackProvider>
      <App />
    </FeedbackProvider>
  )
  return stub
}

// A role query over the whole App computes the accessible name and visibility of every button
// on every screen: 50–400 ms each in jsdom, several times that on a loaded host, enough to
// push a flow past the test timeout (#137). Inside the dialog the same query takes ~2 ms, so
// the wizard is driven through its dialog, and its entry point found by text.
async function openWizard(): Promise<HTMLElement> {
  const label = await screen.findByText(/Set up Developer Mode/)
  const button = label.closest('button')
  expect(button).not.toBeNull()
  if (button) fireEvent.click(button)
  return screen.getByRole('dialog', { name: 'Set up a new stick' })
}

const click = (dialog: HTMLElement, name: string): void => {
  fireEvent.click(within(dialog).getByRole('button', { name }))
}

// Steps 1–2 for an account that is already signed in.
async function toCodeStep(): Promise<HTMLElement> {
  const dialog = await openWizard()
  click(dialog, 'I see the code')
  expect(await within(dialog).findByText('Signed in to Amazon Developer Services')).toBeTruthy()
  click(dialog, 'Continue')
  return dialog
}

const typeCode = (dialog: HTMLElement, code: string): void => {
  fireEvent.change(within(dialog).getByLabelText('Code from the TV'), { target: { value: code } })
}

describe('Setup wizard', () => {
  test('signed out: sign in, enable with the code, wait on USB, then Done', async () => {
    const login = pending<IpcResult<{ signedIn: true }>>()
    const wait = pending<IpcResult<Device>>()
    const { api, prompt: showPrompt } = renderWith({
      signedIn: async () => ({ ok: true, data: false }),
      login: () => login.promise,
      enable: async () => enabled,
      waitForStick: () => wait.promise
    })
    const dialog = await openWizard()
    expect(within(dialog).getByText('Step 1 of 4')).toBeTruthy()
    expect(within(dialog).getByText(/Select the device name 7 times/)).toBeTruthy()
    expect(screen.getByText('$ ovd setup-stick')).toBeTruthy()

    click(dialog, 'I see the code')
    expect(await within(dialog).findByText('vega devmode login')).toBeTruthy()
    click(dialog, 'Sign in')
    expect(api.setup.login).toHaveBeenCalledTimes(1)
    act(() => showPrompt(prompt))
    expect(within(dialog).getByText(prompt.verificationUri)).toBeTruthy()
    expect(within(dialog).getByText('XYZ789')).toBeTruthy()
    expect(within(dialog).getByText('Waiting for sign-in in your browser…')).toBeTruthy()
    await act(async () => login.resolve({ ok: true, data: { signedIn: true } }))
    expect(within(dialog).getByText('Signed in to Amazon Developer Services')).toBeTruthy()
    click(dialog, 'Continue')

    expect(within(dialog).getByText('Enter the code from the TV')).toBeTruthy()
    // An incomplete code can't be sent.
    typeCode(dialog, 'ab1')
    click(dialog, 'Enable Developer Mode')
    expect(api.setup.enable).not.toHaveBeenCalled()
    typeCode(dialog, 'abc-123')
    expect(within(dialog).getByDisplayValue('ABC123')).toBeTruthy()
    expect(within(dialog).getByText('vega devmode enable-device --code ABC123')).toBeTruthy()
    click(dialog, 'Enable Developer Mode')
    expect(api.setup.enable).toHaveBeenCalledWith('ABC123', undefined)
    expect(await within(dialog).findByText('The device is rebooting')).toBeTruthy()
    click(dialog, 'Continue')

    expect(within(dialog).getByText('Connect the stick')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('radio', { name: /USB/ }))
    expect(api.setup.waitForStick).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByText('Waiting for a new stick to appear in Devices…')).toBeTruthy()
    await act(async () => wait.resolve({ ok: true, data: stick }))
    expect(
      within(dialog).getByText('Fire TV stick · G070000000000001 · USB · armv7 — now in Devices')
    ).toBeTruthy()
    click(dialog, 'Done')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Fire TV stick is ready')).toBeTruthy()
  })

  test('a rejected code says so, and "Enter a new code" clears it', async () => {
    const { api } = renderWith({
      signedIn: async () => ({ ok: true, data: true }),
      enable: async () => failed('CODE_REJECTED')
    })
    const dialog = await toCodeStep()
    typeCode(dialog, 'ABC123')
    click(dialog, 'Enable Developer Mode')
    const alert = await within(dialog).findByRole('alert')
    expect(within(alert).getByText('Code is wrong or expired')).toBeTruthy()
    click(dialog, 'Enter a new code')
    expect(within(dialog).getByLabelText<HTMLInputElement>('Code from the TV').value).toBe('')
    expect(within(dialog).queryByRole('alert')).toBeNull()
    expect(api.setup.enable).toHaveBeenCalledTimes(1)
  })

  test('when the SDK asks for a vendor, a Vendor ID field appears and is sent', async () => {
    let calls = 0
    const { api } = renderWith({
      signedIn: async () => ({ ok: true, data: true }),
      enable: async () =>
        ++calls === 1 ? failed('VENDOR_REQUIRED', 'This account has several vendors') : enabled
    })
    const dialog = await toCodeStep()
    expect(within(dialog).queryByLabelText('Vendor ID')).toBeNull()
    typeCode(dialog, 'ABC123')
    click(dialog, 'Enable Developer Mode')
    expect(await within(dialog).findByText('This account has several vendors')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Vendor ID'), {
      target: { value: 'M0000000000001' }
    })
    click(dialog, 'Retry')
    expect(api.setup.enable).toHaveBeenLastCalledWith('ABC123', 'M0000000000001')
    expect(await within(dialog).findByText('The device is rebooting')).toBeTruthy()
  })

  test('signed out at enable: "Sign in again" goes back to the sign-in step', async () => {
    const { api } = renderWith({
      signedIn: async () => ({ ok: true, data: true }),
      enable: async () => failed('NOT_SIGNED_IN'),
      login: async () => ({ ok: true, data: { signedIn: true } })
    })
    const dialog = await toCodeStep()
    typeCode(dialog, 'ABC123')
    click(dialog, 'Enable Developer Mode')
    expect(await within(dialog).findByText('Not signed in')).toBeTruthy()
    click(dialog, 'Sign in again')
    expect(within(dialog).getByText('Step 2 of 4')).toBeTruthy()
    expect(api.setup.login).toHaveBeenCalledTimes(1)
    expect(await within(dialog).findByText('Signed in to Amazon Developer Services')).toBeTruthy()
  })

  test('no stick on USB in time: Retry waits again', async () => {
    let calls = 0
    const { api } = renderWith({
      signedIn: async () => ({ ok: true, data: true }),
      enable: async () => enabled,
      waitForStick: async () =>
        ++calls === 1
          ? failed('DEVICE_NOT_FOUND', 'No new stick appeared on USB', 'Plug the stick in')
          : { ok: true, data: stick }
    })
    const dialog = await toCodeStep()
    typeCode(dialog, 'ABC123')
    click(dialog, 'Enable Developer Mode')
    await within(dialog).findByText('The device is rebooting')
    click(dialog, 'Continue')
    fireEvent.click(within(dialog).getByRole('radio', { name: /USB/ }))
    expect(await within(dialog).findByText('No new stick appeared on USB')).toBeTruthy()
    click(dialog, 'Retry')
    expect(api.setup.waitForStick).toHaveBeenCalledTimes(2)
    expect(await within(dialog).findByText(/now in Devices/)).toBeTruthy()
  })

  test('closing while it waits stops the wait in main', async () => {
    const { api } = renderWith({
      signedIn: async () => ({ ok: true, data: true }),
      enable: async () => enabled,
      waitForStick: () => new Promise(() => {})
    })
    const dialog = await toCodeStep()
    typeCode(dialog, 'ABC123')
    click(dialog, 'Enable Developer Mode')
    await within(dialog).findByText('The device is rebooting')
    click(dialog, 'Continue')
    fireEvent.click(within(dialog).getByRole('radio', { name: /USB/ }))
    click(dialog, 'Cancel')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.setup.cancel).toHaveBeenCalledTimes(1)
  })

  test('Wi-Fi hands over to the pairing wizard', async () => {
    renderWith({ signedIn: async () => ({ ok: true, data: true }), enable: async () => enabled })
    const dialog = await toCodeStep()
    typeCode(dialog, 'ABC123')
    click(dialog, 'Enable Developer Mode')
    await within(dialog).findByText('The device is rebooting')
    click(dialog, 'Continue')
    fireEvent.click(within(dialog).getByRole('radio', { name: /Wi-Fi/ }))
    expect(screen.queryByRole('dialog', { name: 'Set up a new stick' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Pair a device over Wi-Fi' })).toBeTruthy()
  })
})

describe('Setup wizard entry points', () => {
  const opened = () => screen.getByRole('dialog', { name: 'Set up a new stick' })

  test('the target picker', async () => {
    renderWith({})
    fireEvent.click(await screen.findByRole('button', { name: 'Target device' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Set up a new stick/ }))
    expect(opened()).toBeTruthy()
  })

  test('the empty Devices screen', async () => {
    renderWith({}, [])
    fireEvent.click(await screen.findByRole('button', { name: 'Set up a Fire TV stick' }))
    expect(opened()).toBeTruthy()
  })

  test('the pairing wizard', async () => {
    renderWith({})
    fireEvent.click(await screen.findByRole('button', { name: 'Pair over Wi‑Fi' }))
    click(screen.getByRole('dialog', { name: 'Pair a device over Wi-Fi' }), 'Set it up →')
    expect(opened()).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Pair a device over Wi-Fi' })).toBeNull()
  })

  test('the Doctor Developer Mode row', async () => {
    stubOvd({
      list: async () => ready([stick, vvd], stick.id),
      devices: [stick, vvd],
      doctor: () => ({
        ok: true,
        data: doctorReport({
          devmode: { status: 'warn', detail: 'Not signed in', fix: 'setup-stick' }
        })
      })
    })
    render(
      <FeedbackProvider>
        <App />
      </FeedbackProvider>
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Doctor' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Set up' }))
    expect(opened()).toBeTruthy()
  })
})
