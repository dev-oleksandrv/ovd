import type { DevicesUpdate } from '@ovd/core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { IpcResult, OvdApi, SdkSummary } from '../../../src/preload/api'
import { App } from '../../../src/renderer/src/App'
import { FeedbackProvider } from '../../../src/renderer/src/feedback/FeedbackProvider'
import { stick, vvd, wifiOffline } from '../screens/devices/sample'
import { ready, sdkMissing, stubOvd } from '../support/ovdStub'

const devices = [stick, vvd, wifiOffline]

async function renderShell(
  update: DevicesUpdate = ready(devices, stick.id),
  sdk?: IpcResult<SdkSummary> | (() => IpcResult<SdkSummary>),
  platform: 'darwin' | 'linux' = 'darwin'
): Promise<{ api: OvdApi; push: (u: DevicesUpdate) => void }> {
  const stub = stubOvd({ list: async () => update, devices, platform, ...(sdk ? { sdk } : {}) })
  render(
    <FeedbackProvider>
      <App />
    </FeedbackProvider>
  )
  await screen.findByRole('list', { name: 'Devices' }).catch(() => undefined)
  return stub
}

const picker = () => screen.getByRole('button', { name: 'Target device' })
const statusBar = () => screen.getByRole('button', { name: /^Target: / })

describe('target picker', () => {
  test('shows the target with its architecture and connection', async () => {
    await renderShell()
    const button = picker()
    expect(within(button).getByText('Fire TV stick')).toBeTruthy()
    expect(within(button).getByText('armv7')).toBeTruthy()
    expect(within(button).getByText('USB')).toBeTruthy()
  })

  test('lists every device with its ID and status, the target checked', async () => {
    await renderShell()
    fireEvent.click(picker())
    const menu = screen.getByRole('menu', { name: 'Target device' })
    const rows = within(menu).getAllByRole('menuitemradio')
    expect(rows.map((r) => r.textContent)).toEqual([
      'Fire TV stickG070000000000001 · armv7Online',
      'Vega Virtual DeviceVirtualDeviceStopped',
      'Bedroom stick192.0.2.77:5555Offline'
    ])
    expect(rows[0]?.getAttribute('aria-checked')).toBe('true')
  })

  test('picking a device sets it as target, toasts and echoes the command', async () => {
    const { api } = await renderShell()
    fireEvent.click(picker())
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Vega Virtual Device/ }))
    expect(api.devices.setTarget).toHaveBeenCalledWith('VirtualDevice')
    expect(await screen.findByText('Target: Vega Virtual Device')).toBeTruthy()
    expect(screen.getAllByText(/ovd target set VirtualDevice/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  test('picking the current target changes nothing', async () => {
    const { api } = await renderShell()
    fireEvent.click(picker())
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Fire TV stick/ }))
    expect(api.devices.setTarget).not.toHaveBeenCalled()
  })

  test('Esc and a click outside close the menu', async () => {
    await renderShell()
    fireEvent.click(picker())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(picker())
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  test('with no target the picker says No device', async () => {
    await renderShell(ready([vvd]))
    expect(within(picker()).getByText('No device')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Target: / })).toBeNull()
  })
})

describe('status bar', () => {
  test('shows the SDK version and the online target with its architecture', async () => {
    await renderShell()
    expect(await screen.findByText('SDK 0.24.12112')).toBeTruthy()
    expect(statusBar().textContent).toBe('Fire TV stickarmv7')
  })

  test('says SDK not found when core has no SDK', async () => {
    await renderShell(ready(devices, stick.id), sdkMissing)
    expect(await screen.findByText('SDK not found')).toBeTruthy()
  })

  test('checks the SDK again when the device error changes, so an install is noticed', async () => {
    let sdk = sdkMissing
    const failed = (code: 'SDK_NOT_FOUND' | 'VDA_UNAVAILABLE'): DevicesUpdate => ({
      ok: false,
      error: { code, message: code, hint: '' }
    })
    const { push } = await renderShell(failed('SDK_NOT_FOUND'), () => sdk)
    expect(await screen.findByText('SDK not found')).toBeTruthy()
    sdk = { ok: true, data: { sdkVersion: '0.24.12112' } }
    await act(async () => push(failed('VDA_UNAVAILABLE')))
    expect(await screen.findByText('SDK 0.24.12112')).toBeTruthy()
  })

  test('a stopped target carries its state label, and a click opens the picker', async () => {
    await renderShell(ready(devices, vvd.id))
    expect(statusBar().textContent).toBe('Vega Virtual DeviceStopped')
    fireEvent.click(statusBar())
    expect(screen.getByRole('menu', { name: 'Target device' })).toBeTruthy()
  })

  test('follows target changes pushed by main', async () => {
    const { push } = await renderShell()
    act(() => push(ready(devices, wifiOffline.id)))
    expect(statusBar().textContent).toBe('Bedroom stickOffline')
  })
})

describe('command palette', () => {
  const open = (): HTMLElement => {
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    return screen.getByRole('dialog', { name: 'Command palette' })
  }
  const options = (): string[] =>
    screen.getAllByRole('option').map((o) => o.querySelector('div')?.textContent ?? '')

  test('⌘K opens it with Devices, Doctor, the other devices and later screens', async () => {
    await renderShell()
    open()
    expect(options().slice(0, 5)).toEqual([
      'Go to Devices',
      'Go to Doctor',
      'Run ovd doctor',
      'Switch target to Vega Virtual Device',
      'Switch target to Bedroom stick'
    ])
    expect(screen.getAllByText('Coming in a later version')).toHaveLength(9)
  })

  test('on macOS Ctrl+K stays a text shortcut and does not open it', async () => {
    await renderShell()
    await screen.findByText('⌘K')
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('two devices with the same name each get a switch entry without key clashes', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const twin = { ...wifiOffline, name: 'Fire TV stick' }
    await renderShell(ready([stick, twin, { ...twin, id: '192.0.2.78:5555' }], stick.id))
    open()
    expect(options().filter((o) => o === 'Switch target to Fire TV stick')).toHaveLength(2)
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/same key/)
    error.mockRestore()
  })

  test('on Linux Ctrl+K and the search button open it; Esc closes it', async () => {
    await renderShell(ready(devices, stick.id), undefined, 'linux')
    await screen.findByText('Ctrl K')
    fireEvent.keyDown(window, { key: 'K', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Search or run a command/ }))
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy()
  })

  test('typing filters; Enter on a later screen says it is coming', async () => {
    await renderShell()
    open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'crash' } })
    expect(options()).toEqual(['Crashes'])
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText('Crashes is coming in a later version')).toBeTruthy()
  })

  test('arrow keys move the selection and Enter switches the target', async () => {
    const { api } = await renderShell()
    open()
    const input = screen.getByRole('combobox')
    for (let i = 0; i < 4; i++) fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(screen.getAllByRole('option')[3]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(api.devices.setTarget).toHaveBeenCalledWith('VirtualDevice')
  })

  test('a click on the backdrop closes it', async () => {
    await renderShell()
    const dialog = open()
    fireEvent.click(dialog.parentElement as HTMLElement)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
