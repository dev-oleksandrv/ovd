import type { Device, RemoteKey } from '@ovd/core'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type {
  InputOutcome,
  InputState,
  ScreenFramePush,
  ScreenRefreshed
} from '../../../../src/preload/api'
import { DevicesProvider } from '../../../../src/renderer/src/devices/DevicesProvider'
import { FeedbackProvider } from '../../../../src/renderer/src/feedback/FeedbackProvider'
import { ToastViewport } from '../../../../src/renderer/src/feedback/ToastViewport'
import { StatusBar } from '../../../../src/renderer/src/frame/StatusBar'
import { RemoteScreen } from '../../../../src/renderer/src/screens/remote/RemoteScreen'
import { ScreenshotProvider } from '../../../../src/renderer/src/screenshot/ScreenshotProvider'
import { ready, stubOvd, type OvdStub } from '../../support/ovdStub'
import { stick, vvd, wifiOffline } from '../devices/sample'

const onlineVvd: Device = { ...vvd, status: 'online', vdaSerial: 'emulator-5554' }
const LIVE = { id: onlineVvd.id, name: onlineVvd.name }
const TAKEN = new Date(2026, 10, 12, 4, 5, 6).toISOString()
const shot = {
  target: { id: stick.id, name: stick.name },
  backend: 'gwsi-tool-screenshooter' as const,
  path: '/home/developer/ovd/captures/fire-tv-stick-20261112-040506.png',
  width: 1920,
  height: 1080,
  bytes: 9780,
  takenAt: TAKEN
}

const frame = (seq: number, size = 4): ScreenFramePush => ({
  seq,
  width: 1,
  height: 1,
  timestampUs: 0,
  pixels: new Uint8Array(size)
})

// jsdom has no 2D canvas, ImageData or Blob URLs; these stand in for what the frames go to.
const putImageData = vi.fn()
let visibility: DocumentVisibilityState = 'visible'
beforeEach(() => {
  putImageData.mockClear()
  visibility = 'visible'
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ putImageData }) as unknown as CanvasRenderingContext2D
  )
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number
      ) {}
    }
  )
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:shot-${++n}`)
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  document.dispatchEvent(new Event('visibilitychange'))
}

const readyFor = (device: Device): InputState => ({
  status: 'ready',
  target: { id: device.id, name: device.name },
  backend: device.kind === 'vvd' ? 'grpc' : 'inputd-cli',
  sent: []
})

function renderScreen(
  devices: Device[],
  opts: {
    press?: (key: RemoteKey) => Promise<InputOutcome>
    refresh?: () => Promise<ScreenRefreshed | { error: string }>
  } = {}
): OvdStub {
  const target = devices[0] ?? stick
  const stub = stubOvd({
    list: async () => ready(devices, target.id),
    devices,
    input: {
      open: async (id) => {
        const state = readyFor(devices.find((d) => d.id === id) ?? stick)
        queueMicrotask(() => stub.pushInput(state))
        return state
      },
      press:
        opts.press ??
        (async (key) => ({
          ok: true,
          sent: {
            time: TAKEN,
            kind: 'press',
            label: key,
            cli: `ovd input press ${key} --device ${target.id}`,
            ok: true
          },
          result: { target: { id: target.id, name: target.name }, backend: 'grpc', keys: [key] }
        }))
    },
    screen: {
      ...(opts.refresh
        ? {
            refresh: async () => {
              const r = await opts.refresh?.()
              if (!r || 'error' in r) {
                return {
                  ok: false,
                  error: { code: 'SCREENSHOT_FAILED', message: 'It failed', hint: 'h' }
                }
              }
              return { ok: true, data: r }
            }
          }
        : {})
    }
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

describe('ScreenView on the Virtual Device', () => {
  async function live(stub: OvdStub) {
    await waitFor(() => expect(stub.api.screen.start).toHaveBeenCalledWith(onlineVvd.id))
    act(() => stub.pushScreen({ status: 'live', target: LIVE }))
    return screen.findByLabelText('Live · emulator gRPC')
  }

  test('connecting, then live: each frame is drawn and acked', async () => {
    const stub = renderScreen([onlineVvd])
    expect(await screen.findByText('Connecting to the screen of Vega Virtual Device…')).toBeTruthy()
    const canvas = await live(stub)
    expect(screen.getByText('Live · emulator gRPC')).toBeTruthy()
    act(() => stub.pushFrame(frame(1)))
    act(() => stub.pushFrame(frame(2)))
    expect(canvas.getAttribute('data-frames')).toBe('2')
    expect(putImageData).toHaveBeenCalledTimes(2)
    expect(stub.api.screen.ack).toHaveBeenCalledWith(1)
    expect(stub.api.screen.ack).toHaveBeenCalledWith(2)
  })

  test('a frame of the wrong size is dropped: acked, not drawn', async () => {
    const stub = renderScreen([onlineVvd])
    const canvas = await live(stub)
    act(() => stub.pushFrame(frame(1, 3)))
    expect(putImageData).not.toHaveBeenCalled()
    expect(canvas.getAttribute('data-frames')).toBe('0')
    expect(stub.api.screen.ack).toHaveBeenCalledWith(1)
  })

  test('hidden: nothing is drawn or acked; visible again: the held frame is', async () => {
    const stub = renderScreen([onlineVvd])
    const canvas = await live(stub)
    act(() => setVisibility('hidden'))
    act(() => stub.pushFrame(frame(1)))
    act(() => stub.pushFrame(frame(2)))
    expect(putImageData).not.toHaveBeenCalled()
    expect(stub.api.screen.ack).not.toHaveBeenCalled()
    act(() => setVisibility('visible'))
    // Only the newest frame is drawn.
    expect(canvas.getAttribute('data-frames')).toBe('1')
    expect(stub.api.screen.ack).toHaveBeenCalledTimes(1)
    expect(stub.api.screen.ack).toHaveBeenCalledWith(2)
    // Pausing restarts nothing.
    expect(stub.api.screen.start).toHaveBeenCalledTimes(1)
  })

  test('an error shows its message and hint; Retry starts it again', async () => {
    const stub = renderScreen([onlineVvd])
    await waitFor(() => expect(stub.api.screen.start).toHaveBeenCalledTimes(1))
    act(() =>
      stub.pushScreen({
        status: 'error',
        target: LIVE,
        error: { code: 'VVD_GRPC_FAILED', message: 'Emulator gRPC failed', hint: 'Fix it' }
      })
    )
    expect(await screen.findByText('Emulator gRPC failed')).toBeTruthy()
    expect(screen.getByText('Fix it')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0] as HTMLElement)
    expect(stub.api.screen.start).toHaveBeenCalledTimes(2)
  })

  test('no signal from main; the device away and back starts it again by itself', async () => {
    const stub = renderScreen([onlineVvd])
    await live(stub)
    act(() => stub.pushScreen({ status: 'no-signal', target: LIVE }))
    expect(await screen.findByText('No signal')).toBeTruthy()
    act(() => stub.push(ready([{ ...onlineVvd, status: 'stopped' }], onlineVvd.id)))
    expect(await screen.findByText('Vega Virtual Device is stopped')).toBeTruthy()
    expect(stub.api.screen.stop).toHaveBeenCalled()
    act(() => stub.push(ready([{ ...onlineVvd, status: 'starting' }], onlineVvd.id)))
    expect(await screen.findByText('Waiting for Vega Virtual Device…')).toBeTruthy()
    act(() => stub.push(ready([onlineVvd], onlineVvd.id)))
    await waitFor(() => expect(stub.api.screen.start).toHaveBeenCalledTimes(2))
  })

  test('unmount stops the live view', async () => {
    const stub = renderScreen([onlineVvd])
    await live(stub)
    const stops = vi.mocked(stub.api.screen.stop).mock.calls.length
    act(() => stub.push(ready([stick], stick.id)))
    await waitFor(() =>
      expect(vi.mocked(stub.api.screen.stop).mock.calls.length).toBeGreaterThan(stops)
    )
  })
})

describe('ScreenView on a stick', () => {
  const refreshed = { shot, png: Uint8Array.from([0x89, 0x50]) }

  test('empty, then Refresh: the latest screenshot, echoed and toasted', async () => {
    const stub = renderScreen([stick], { refresh: async () => refreshed })
    expect(await screen.findByText('No screenshot yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(stub.api.screen.refresh).toHaveBeenCalledWith(stick.id)
    expect(await screen.findByRole('img', { name: 'Latest screenshot · 04:05:06' })).toBeTruthy()
    expect(screen.getByText('Latest screenshot · 04:05:06')).toBeTruthy()
    expect(await screen.findByText('Saved fire-tv-stick-20261112-040506.png')).toBeTruthy()
    expect(
      screen.getAllByText(new RegExp(`ovd screenshot --device ${stick.id}$`)).length
    ).toBeGreaterThan(0)
    // No live view on a stick.
    expect(stub.api.screen.start).not.toHaveBeenCalled()
  })

  test('a second Refresh revokes the previous image', async () => {
    renderScreen([stick], { refresh: async () => refreshed })
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }))
    await screen.findByRole('img')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:shot-1'))
  })

  test('a failed Refresh toasts the error with the CLI', async () => {
    renderScreen([stick], { refresh: async () => ({ error: 'x' }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('It failed')).toBeTruthy()
    expect(screen.getByText('No screenshot yet')).toBeTruthy()
  })

  test('out of date only after a key the device took, not after a failed one', async () => {
    let ok = false
    renderScreen([stick], {
      refresh: async () => refreshed,
      press: async (key): Promise<InputOutcome> => {
        const sent = {
          time: TAKEN,
          kind: 'press' as const,
          label: key,
          cli: `ovd input press ${key} --device ${stick.id}`
        }
        return ok
          ? {
              ok: true,
              sent: { ...sent, ok: true },
              result: {
                target: { id: stick.id, name: stick.name },
                backend: 'inputd-cli',
                keys: [key]
              }
            }
          : {
              ok: false,
              sent: {
                ...sent,
                ok: false,
                error: { code: 'INPUT_FAILED', message: 'no', hint: 'h' }
              }
            }
      }
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh' }))
    await screen.findByRole('img')
    fireEvent.click(screen.getByRole('button', { name: 'Up' }))
    await screen.findByText('no')
    expect(screen.queryByText('Out of date')).toBeNull()
    ok = true
    fireEvent.click(screen.getByRole('button', { name: 'Down' }))
    expect(await screen.findByText('Out of date')).toBeTruthy()
  })

  test('the header’s Screenshot shows there too', async () => {
    const stub = stubAndTake()
    fireEvent.click(await screen.findByRole('button', { name: 'Screenshot' }))
    await waitFor(() => expect(stub.api.screen.image).toHaveBeenCalledWith(shot.path))
    expect(await screen.findByRole('img', { name: 'Latest screenshot · 04:05:06' })).toBeTruthy()
  })

  function stubAndTake(): OvdStub {
    const stub = renderScreen([stick])
    vi.mocked(stub.api.screenshot.take).mockImplementation(async () => ({
      ok: true,
      data: { ...shot, copied: true }
    }))
    return stub
  }

  test('an offline stick: No signal above Remote unavailable', async () => {
    renderScreen([wifiOffline])
    expect(await screen.findByText('No signal')).toBeTruthy()
    expect(screen.getByText('Bedroom stick is offline')).toBeTruthy()
    expect(screen.getByText('Remote unavailable — Bedroom stick is offline')).toBeTruthy()
  })
})
