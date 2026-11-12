import type { Device, RemoteKey } from '@ovd/core'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { InputOutcome, InputSent, InputState } from '../../../../src/preload/api'
import { DevicesProvider } from '../../../../src/renderer/src/devices/DevicesProvider'
import { FeedbackProvider } from '../../../../src/renderer/src/feedback/FeedbackProvider'
import { ToastViewport } from '../../../../src/renderer/src/feedback/ToastViewport'
import { StatusBar } from '../../../../src/renderer/src/frame/StatusBar'
import { RemoteScreen } from '../../../../src/renderer/src/screens/remote/RemoteScreen'
import { ScreenshotProvider } from '../../../../src/renderer/src/screenshot/ScreenshotProvider'
import { ready, stubOvd, type OvdStub } from '../../support/ovdStub'
import { stick, vvd, wifiOffline } from '../devices/sample'

const onlineVvd: Device = { ...vvd, status: 'online', vdaSerial: 'emulator-5554' }

const readyFor = (device: Device): InputState => ({
  status: 'ready',
  target: { id: device.id, name: device.name },
  backend: device.kind === 'vvd' ? 'grpc' : 'inputd-cli',
  sent: []
})

const sentEntry = (key: string, device: Device, ok = true): InputSent => ({
  time: '2026-11-11T10:00:00.000Z',
  kind: 'press',
  label: key,
  cli: `ovd input press ${key} --device ${device.id}`,
  ok,
  ...(ok
    ? {}
    : { error: { code: 'TARGET_OFFLINE', message: 'Fire TV stick is offline', hint: 'h' } })
})

async function renderScreen(
  opts: {
    devices?: Device[]
    open?: (device: string) => Promise<InputState>
    press?: (key: RemoteKey) => Promise<InputOutcome>
    text?: (text: string) => Promise<InputOutcome>
    screenshot?: Parameters<typeof stubOvd>[0]['screenshot']
  } = {}
): Promise<OvdStub> {
  const devices = opts.devices ?? [stick]
  const device = devices[0]
  const stub = stubOvd({
    list: async () => ready(devices, device?.id ?? null),
    devices,
    input: {
      open:
        opts.open ??
        (async (id: string) => {
          const state = readyFor(devices.find((d) => d.id === id) ?? stick)
          queueMicrotask(() => stub.pushInput(state))
          return state
        }),
      press:
        opts.press ??
        (async (key) => ({
          ok: true,
          sent: sentEntry(key, device ?? stick),
          result: { target: { id: stick.id, name: stick.name }, backend: 'inputd-cli', keys: [key] }
        })),
      ...(opts.text ? { text: opts.text } : {})
    },
    ...(opts.screenshot ? { screenshot: opts.screenshot } : {})
  })
  render(
    <FeedbackProvider>
      <DevicesProvider>
        <ScreenshotProvider>
          <RemoteScreen onSwitchTarget={() => undefined} />
        </ScreenshotProvider>
      </DevicesProvider>
      <StatusBar />
      <ToastViewport />
    </FeedbackProvider>
  )
  return stub
}

describe('RemoteScreen', () => {
  test('no target: an empty state that offers one', async () => {
    await renderScreen({ devices: [] })
    expect(await screen.findByText('No target device')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Choose a target' })).toBeTruthy()
  })

  test('an offline target: Remote unavailable, and no session is opened', async () => {
    const stub = await renderScreen({ devices: [wifiOffline] })
    expect(await screen.findByText('Remote unavailable — Bedroom stick is offline')).toBeTruthy()
    expect(stub.api.input.open).not.toHaveBeenCalled()
  })

  test('opening: a loading state', async () => {
    await renderScreen({ open: () => new Promise(() => undefined) })
    expect(await screen.findByText('Connecting the remote to Fire TV stick…')).toBeTruthy()
  })

  test('a session that failed: its error and hint, and Retry opens it again', async () => {
    const failed: InputState = {
      status: 'error',
      target: { id: stick.id, name: stick.name },
      backend: null,
      sent: [],
      error: {
        code: 'INPUT_FAILED',
        message: 'inputd-cli on Fire TV stick didn’t answer in time',
        hint: 'Check the device'
      }
    }
    const stub = await renderScreen({
      open: async () => {
        queueMicrotask(() => stub.pushInput(failed))
        return failed
      }
    })
    expect(
      await screen.findByText('inputd-cli on Fire TV stick didn’t answer in time')
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(stub.api.input.open).toHaveBeenCalledTimes(2)
  })

  test('a pad key sends it, flashes it and echoes its CLI without a toast', async () => {
    const stub = await renderScreen()
    const remote = await screen.findByRole('group', { name: 'Remote' })
    const down = within(remote).getByRole('button', { name: 'Down' })
    fireEvent.click(down)
    expect(stub.api.input.press).toHaveBeenCalledWith('down')
    expect(down.dataset.flash).toBe('true')
    await waitFor(() =>
      expect(screen.getByTitle('Copy CLI equivalent').textContent).toContain(
        `ovd input press down --device ${stick.id}`
      )
    )
    // No toast for a press that worked.
    expect(screen.queryByText('Pressed down')).toBeNull()
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(0)
  })

  test('arrow keys press the D-pad; typing in Type into TV does not', async () => {
    const stub = await renderScreen()
    await screen.findByRole('group', { name: 'Remote' })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(stub.api.input.press).toHaveBeenCalledWith('down')
    const field = screen.getByRole('textbox', { name: 'Text to type' })
    fireEvent.keyDown(field, { key: 'ArrowLeft' })
    fireEvent.keyDown(field, { key: 'h' })
    expect(stub.api.input.press).toHaveBeenCalledTimes(1)
  })

  test('Send types the text and clears the field once it went through', async () => {
    const text = vi.fn(async (value: string): Promise<InputOutcome> => ({
      ok: true,
      sent: {
        ...sentEntry('x', stick),
        kind: 'text',
        label: `"${value}"`,
        cli: `ovd input text "${value}" --device ${stick.id}`
      },
      result: {
        target: { id: stick.id, name: stick.name },
        backend: 'inputd-cli',
        text: value,
        length: value.length
      }
    }))
    await renderScreen({ text })
    const field = await screen.findByRole('textbox', { name: 'Text to type' })
    fireEvent.change(field, { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(text).toHaveBeenCalledWith('hello')
    await waitFor(() => expect((field as HTMLInputElement).value).toBe(''))
    expect(screen.getByTitle('Copy CLI equivalent').textContent).toContain(
      `ovd input text "hello" --device ${stick.id}`
    )
  })

  test('a failed press toasts its error with the CLI echo', async () => {
    await renderScreen({
      press: async (key) => ({ ok: false, sent: sentEntry(key, stick, false) })
    })
    const remote = await screen.findByRole('group', { name: 'Remote' })
    fireEvent.click(within(remote).getByRole('button', { name: 'OK' }))
    expect(await screen.findByText('Fire TV stick is offline')).toBeTruthy()
  })

  test('on the Virtual Device Home is disabled with the reason, and H sends nothing', async () => {
    const stub = await renderScreen({ devices: [onlineVvd] })
    const remote = await screen.findByRole('group', { name: 'Remote' })
    const home = within(remote).getByRole('button', { name: 'Home' })
    expect((home as HTMLButtonElement).disabled).toBe(true)
    expect(home.getAttribute('title')).toBe('Home can’t be sent to the Virtual Device')
    fireEvent.click(home)
    fireEvent.keyDown(window, { key: 'h' })
    expect(stub.api.input.press).not.toHaveBeenCalled()
  })

  test('the session panel lists what was sent', async () => {
    const stub = await renderScreen()
    await screen.findByRole('group', { name: 'Remote' })
    act(() => stub.pushInput({ ...readyFor(stick), sent: [sentEntry('ok', stick)] }))
    const list = await screen.findByRole('list', { name: 'Sent' })
    expect(within(list).getByText('Pressed ok')).toBeTruthy()
  })
})

describe('RemoteScreen screenshots', () => {
  const PATH = '/home/developer/ovd/captures/fire-tv-stick-20261112-021100.png'
  const taken = (copied: boolean) => ({
    ok: true as const,
    data: {
      target: { id: stick.id, name: stick.name },
      backend: 'gwsi-tool-screenshooter' as const,
      path: PATH,
      width: 1920,
      height: 1080,
      bytes: 9780,
      takenAt: '2026-11-12T02:11:00.000Z',
      copied
    }
  })
  const capture = {
    name: 'fire-tv-stick-20261112-021100.png',
    path: PATH,
    bytes: 9780,
    width: 1920,
    height: 1080,
    takenAt: '2026-11-12T02:11:00.000Z'
  }
  const shotButton = () => screen.getByRole('button', { name: /Screenshot|Taking screenshot/ })

  test('Screenshot takes one for the target, toasts the file and echoes the CLI', async () => {
    const stub = await renderScreen({ screenshot: { take: async () => taken(true) } })
    await screen.findByRole('group', { name: 'Remote' })
    fireEvent.click(shotButton())
    expect(stub.api.screenshot.take).toHaveBeenCalledWith(stick.id)
    expect(
      await screen.findByText('Saved fire-tv-stick-20261112-021100.png · copied to the clipboard')
    ).toBeTruthy()
    expect(
      screen.getAllByText(new RegExp(`ovd screenshot --clipboard --device ${stick.id}`)).length
    ).toBeGreaterThan(0)
  })

  test('not copied: a warning that still says it was saved', async () => {
    await renderScreen({ screenshot: { take: async () => taken(false) } })
    await screen.findByRole('group', { name: 'Remote' })
    fireEvent.click(shotButton())
    expect(
      await screen.findByText(
        'Saved fire-tv-stick-20261112-021100.png · couldn’t copy it to the clipboard'
      )
    ).toBeTruthy()
  })

  test('a failed take toasts the error with the CLI', async () => {
    await renderScreen({
      screenshot: {
        take: async () => ({
          ok: false,
          error: {
            code: 'SCREENSHOT_FAILED',
            message: 'Fire TV stick gave an empty or invalid screenshot',
            hint: 'h'
          }
        })
      }
    })
    await screen.findByRole('group', { name: 'Remote' })
    fireEvent.click(shotButton())
    expect(
      await screen.findByText('Fire TV stick gave an empty or invalid screenshot')
    ).toBeTruthy()
  })

  test('while a take runs the button is busy and a second click sends nothing', async () => {
    const stub = await renderScreen()
    await screen.findByRole('group', { name: 'Remote' })
    fireEvent.click(shotButton())
    expect(await screen.findByRole('button', { name: 'Taking screenshot…' })).toBeTruthy()
    fireEvent.click(shotButton())
    expect(stub.api.screenshot.take).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['an offline target', [wifiOffline], 'Bedroom stick is offline'],
    ['no target', [], 'No target device']
  ])('with %s the button is disabled with the reason', async (_label, devices, reason) => {
    const stub = await renderScreen({ devices })
    await waitFor(() => expect(shotButton().getAttribute('title')).toBe(reason))
    expect((shotButton() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(shotButton())
    expect(stub.api.screenshot.take).not.toHaveBeenCalled()
  })

  test('Captures: empty, then the pushed list, with Show in folder (no echo)', async () => {
    const stub = await renderScreen()
    expect(await screen.findByText('No screenshots yet')).toBeTruthy()
    act(() => stub.pushCaptures({ dir: '/home/developer/ovd/captures', captures: [capture] }))
    const list = await screen.findByRole('list', { name: 'Captures' })
    expect(within(list).getByText(capture.name)).toBeTruthy()
    expect(within(list).getByText(/1920×1080 · 9\.6 KB/)).toBeTruthy()
    fireEvent.click(within(list).getByRole('button', { name: 'Show in folder' }))
    expect(stub.api.screenshot.reveal).toHaveBeenCalledWith(PATH)
    fireEvent.click(screen.getByRole('button', { name: 'Open folder' }))
    expect(stub.api.screenshot.openFolder).toHaveBeenCalled()
    expect(screen.queryByTitle('Copy CLI equivalent')).toBeNull()
  })

  test('Captures: an error with Retry, which reads the folder again', async () => {
    let fail = true
    const stub = await renderScreen({
      screenshot: {
        captures: async () =>
          fail
            ? {
                ok: false,
                error: {
                  code: 'COMMAND_FAILED',
                  message: 'Can’t read the folder',
                  hint: 'Check it'
                }
              }
            : { ok: true, data: { dir: '/home/developer/ovd/captures', captures: [capture] } }
      }
    })
    expect(await screen.findByText('Can’t read the folder')).toBeTruthy()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('list', { name: 'Captures' })).toBeTruthy()
    expect(stub.api.screenshot.captures).toHaveBeenCalledTimes(2)
  })

  test('the list is read on mount and again on window focus', async () => {
    const stub = await renderScreen()
    await screen.findByText('No screenshots yet')
    expect(stub.api.screenshot.captures).toHaveBeenCalledTimes(1)
    act(() => void window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(stub.api.screenshot.captures).toHaveBeenCalledTimes(2))
  })
})
