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

async function openWizard(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: /Set up Developer Mode/ }))
  return screen.getByRole('dialog', { name: 'Set up a new stick' })
}

const click = (name: string): void => {
  fireEvent.click(screen.getByRole('button', { name }))
}

// Steps 1–2 for an account that is already signed in.
async function toCodeStep(): Promise<HTMLElement> {
  const dialog = await openWizard()
  click('I see the code')
  expect(await within(dialog).findByText('Signed in to Amazon Developer Services')).toBeTruthy()
  click('Continue')
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

    click('I see the code')
    expect(await within(dialog).findByText('vega devmode login')).toBeTruthy()
    click('Sign in')
    expect(api.setup.login).toHaveBeenCalledTimes(1)
    act(() => showPrompt(prompt))
    expect(within(dialog).getByText(prompt.verificationUri)).toBeTruthy()
    expect(within(dialog).getByText('XYZ789')).toBeTruthy()
    expect(within(dialog).getByText('Waiting for sign-in in your browser…')).toBeTruthy()
    await act(async () => login.resolve({ ok: true, data: { signedIn: true } }))
    expect(within(dialog).getByText('Signed in to Amazon Developer Services')).toBeTruthy()
    click('Continue')

    expect(within(dialog).getByText('Enter the code from the TV')).toBeTruthy()
    // An incomplete code can't be sent.
    typeCode(dialog, 'ab1')
    click('Enable Developer Mode')
    expect(api.setup.enable).not.toHaveBeenCalled()
    typeCode(dialog, 'abc-123')
    expect(within(dialog).getByDisplayValue('ABC123')).toBeTruthy()
    expect(within(dialog).getByText('vega devmode enable-device --code ABC123')).toBeTruthy()
    click('Enable Developer Mode')
    expect(api.setup.enable).toHaveBeenCalledWith('ABC123', undefined)
    expect(await within(dialog).findByText('The device is rebooting')).toBeTruthy()
    click('Continue')

    expect(within(dialog).getByText('Connect the stick')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('radio', { name: /USB/ }))
    expect(api.setup.waitForStick).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByText('Waiting for a new stick to appear in Devices…')).toBeTruthy()
    await act(async () => wait.resolve({ ok: true, data: stick }))
    expect(
      within(dialog).getByText('Fire TV stick · G070000000000001 · USB · armv7 — now in Devices')
    ).toBeTruthy()
    click('Done')
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
    click('Enable Developer Mode')
    const alert = await within(dialog).findByRole('alert')
    expect(within(alert).getByText('Code is wrong or expired')).toBeTruthy()
    click('Enter a new code')
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
    click('Enable Developer Mode')
    expect(await within(dialog).findByText('This account has several vendors')).toBeTruthy()
    fireEvent.change(within(dialog).getByLabelText('Vendor ID'), {
      target: { value: 'M0000000000001' }
    })
    click('Retry')
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
    click('Enable Developer Mode')
    expect(await within(dialog).findByText('Not signed in')).toBeTruthy()
    click('Sign in again')
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
    click('Enable Developer Mode')
    await within(dialog).findByText('The device is rebooting')
    click('Continue')
    fireEvent.click(within(dialog).getByRole('radio', { name: /USB/ }))
    expect(await within(dialog).findByText('No new stick appeared on USB')).toBeTruthy()
    click('Retry')
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
    click('Enable Developer Mode')
    await within(dialog).findByText('The device is rebooting')
    click('Continue')
    fireEvent.click(within(dialog).getByRole('radio', { name: /USB/ }))
    click('Cancel')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.setup.cancel).toHaveBeenCalledTimes(1)
  })

  test('Wi-Fi hands over to the pairing wizard', async () => {
    renderWith({ signedIn: async () => ({ ok: true, data: true }), enable: async () => enabled })
    const dialog = await toCodeStep()
    typeCode(dialog, 'ABC123')
    click('Enable Developer Mode')
    await within(dialog).findByText('The device is rebooting')
    click('Continue')
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
    click('Set it up →')
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
