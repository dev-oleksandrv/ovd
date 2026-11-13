import type { Crash, CrashPullResult, Device } from '@ovd/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { CrashCopied, CrashDetailResult, IpcResult, OvdApi } from '../../../../src/preload/api'
import { DevicesProvider } from '../../../../src/renderer/src/devices/DevicesProvider'
import { FeedbackProvider } from '../../../../src/renderer/src/feedback/FeedbackProvider'
import { ToastViewport } from '../../../../src/renderer/src/feedback/ToastViewport'
import { StatusBar } from '../../../../src/renderer/src/frame/StatusBar'
import { newCount, resetCrashNew } from '../../../../src/renderer/src/screens/crashes/crashNew'
import {
  CrashesScreen,
  type OpenCrashRequest
} from '../../../../src/renderer/src/screens/crashes/CrashesScreen'
import { ready, stubOvd, type OvdStub } from '../../support/ovdStub'
import { stick, wifiOffline } from '../devices/sample'
import { jsCrash, nativeCrash } from './sample'

afterEach(() => {
  cleanup()
  resetCrashNew()
})

const listed =
  (crashes: Crash[]) => async (): Promise<IpcResult<{ device: string; crashes: Crash[] }>> => ({
    ok: true,
    data: { device: stick.id, crashes }
  })

const hostile = [
  'Error: <img src=x onerror=alert(1)> **bold** [link](https://evil.example.com)',
  '    at https://evil.example.com/app.js:1:1'
]
const detailOf = (crash: Crash, stack = hostile): CrashDetailResult => ({
  crash,
  reason: 'abort() called',
  stack,
  device: { id: stick.id, name: stick.name }
})

interface Options {
  devices?: Device[]
  crashes?: Partial<Omit<OvdApi['crashes'], 'onNew'>>
  openRequest?: OpenCrashRequest | null
  onOpenHandled?: () => void
  onOpenLogs?: (crash: Crash) => void
}

function renderScreen(opts: Options = {}): OvdStub {
  const devices = opts.devices ?? [stick]
  const stub = stubOvd({
    list: async () => ready(devices, devices[0]?.id ?? null),
    devices,
    crashes: {
      list: listed([jsCrash, nativeCrash]),
      detail: async (ref) => ({
        ok: true,
        data: detailOf(ref.id === jsCrash.id ? jsCrash : nativeCrash)
      }),
      ...opts.crashes
    }
  })
  render(
    <FeedbackProvider>
      <DevicesProvider>
        <CrashesScreen
          onSwitchTarget={() => undefined}
          onOpenLogs={opts.onOpenLogs ?? (() => undefined)}
          {...(opts.openRequest ? { openRequest: opts.openRequest } : {})}
          {...(opts.onOpenHandled ? { onOpenHandled: opts.onOpenHandled } : {})}
        />
      </DevicesProvider>
      <StatusBar />
      <ToastViewport />
    </FeedbackProvider>
  )
  return stub
}

const echoed = () => screen.getByTitle('Copy CLI equivalent').textContent ?? ''
const rowOf = async (pkg: string): Promise<HTMLElement> => {
  const cell = await within(await screen.findByRole('table')).findByText(pkg)
  return cell.closest('[role="row"]') as HTMLElement
}

describe('CrashesScreen states', () => {
  test('the subtitle and the list echo', async () => {
    renderScreen()
    expect(
      await screen.findByText('loggingctl vault · scoped to your apps · polling every 5 s')
    ).toBeTruthy()
    await waitFor(() => expect(echoed()).toContain(`ovd crashes --device ${stick.id}`))
  })

  test('loading while the list is read', async () => {
    renderScreen({ crashes: { list: () => new Promise(() => undefined) } })
    expect(await screen.findByText(`Reading crashes on ${stick.name}…`)).toBeTruthy()
  })

  test('empty: no crashes of your apps on the device', async () => {
    renderScreen({ crashes: { list: listed([]) } })
    expect(await screen.findByText(`No crashes of your apps on ${stick.name}`)).toBeTruthy()
  })

  test('error: the message, the hint and the command', async () => {
    renderScreen({
      crashes: {
        list: async () => ({
          ok: false,
          error: {
            code: 'CRASH_ACCESS_DENIED',
            message: 'Access denied',
            hint: 'Reinstall the app'
          }
        })
      }
    })
    expect(await screen.findByText('Access denied')).toBeTruthy()
    expect(screen.getByText('Reinstall the app')).toBeTruthy()
    expect(screen.getAllByText(`$ ovd crashes --device ${stick.id}`).length).toBeGreaterThan(0)
  })

  test('offline target: Crashes unavailable, and nothing is read', async () => {
    const stub = renderScreen({ devices: [wifiOffline] })
    expect(
      await screen.findByText(`Crashes unavailable — ${wifiOffline.name} is offline`)
    ).toBeTruthy()
    expect(stub.api.crashes.list).not.toHaveBeenCalled()
  })

  test('no target', async () => {
    renderScreen({ devices: [] })
    expect(await screen.findByText('No target device')).toBeTruthy()
  })
})

describe('the list', () => {
  test('a row has the kind chip, app, NEW, age, summary and pid · build · device', async () => {
    renderScreen()
    const row = await rowOf('com.example.player')
    expect(within(row).getByText('js')).toBeTruthy()
    expect(within(row).getByText('NEW')).toBeTruthy()
    expect(within(row).getByText('Error: player deliberate crash')).toBeTruthy()
    expect(within(row).getByText(`pid 3200 · 1.4.2 (142) · ${stick.name}`)).toBeTruthy()
    expect(row.querySelector('time')?.getAttribute('datetime')).toBe(jsCrash.time)
    const other = await rowOf('com.example.hellovega')
    expect(within(other).getByText('native')).toBeTruthy()
    expect(within(other).queryByText('NEW')).toBeNull()
  })

  test('opening a crash clears its NEW', async () => {
    renderScreen()
    const row = await rowOf('com.example.player')
    expect(newCount(stick.id)).toBe(1)
    fireEvent.click(row)
    await screen.findByRole('complementary', { name: 'Crash 2100 details' })
    expect(newCount(stick.id)).toBe(0)
    expect(within(await rowOf('com.example.player')).queryByText('NEW')).toBeNull()
  })

  test('a push from main reloads the list', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: { device: stick.id, crashes: [nativeCrash] } })
      .mockResolvedValue({ ok: true, data: { device: stick.id, crashes: [jsCrash, nativeCrash] } })
    const stub = renderScreen({ crashes: { list } })
    await rowOf('com.example.hellovega')
    act(() => stub.pushCrash({ device: { id: stick.id, name: stick.name }, crash: jsCrash }))
    expect(await screen.findByText('com.example.player')).toBeTruthy()
  })
})

describe('the detail', () => {
  const open = async (): Promise<HTMLElement> => {
    fireEvent.click(await rowOf('com.example.player'))
    return screen.findByRole('complementary', { name: 'Crash 2100 details' })
  }

  test('the stack is plain text: no markup, no markdown, no links', async () => {
    renderScreen()
    const panel = await open()
    const stack = await within(panel).findByLabelText('Crash stack')
    expect(stack.textContent).toBe(hostile.join('\n'))
    expect(panel.querySelector('img')).toBeNull()
    expect(panel.querySelector('a')).toBeNull()
    expect(panel.querySelector('strong')).toBeNull()
    expect(within(panel).getByText('abort() called')).toBeTruthy()
  })

  test('a native report says it has no JavaScript stack', async () => {
    renderScreen({
      crashes: { detail: async () => ({ ok: true, data: detailOf(jsCrash, []) }) }
    })
    const panel = await open()
    expect(await within(panel).findByText('This report has no JavaScript stack.')).toBeTruthy()
  })

  test('a detail error is shown in the panel', async () => {
    renderScreen({
      crashes: {
        detail: async () => ({
          ok: false,
          error: { code: 'CRASH_NOT_FOUND', message: 'Crash 2100 is gone', hint: 'List them' }
        })
      }
    })
    const panel = await open()
    expect(await within(panel).findByText('Crash 2100 is gone')).toBeTruthy()
  })

  test('Download ACR pulls, toasts the path and echoes ovd crash pull', async () => {
    const pull = vi.fn(async (): Promise<IpcResult<CrashPullResult>> => ({
      ok: true,
      data: {
        crash: jsCrash,
        path: '/home/developer/ovd/crashes/com.example.player-1-3200.acr',
        bytes: 301471
      }
    }))
    const stub = renderScreen({
      crashes: { pull, reveal: async () => ({ ok: true, data: null }) }
    })
    const panel = await open()
    expect(within(panel).queryByRole('button', { name: 'Show in folder' })).toBeNull()
    fireEvent.click(within(panel).getByRole('button', { name: 'Download ACR' }))
    expect(
      await screen.findByText(
        'Saved crash report to /home/developer/ovd/crashes/com.example.player-1-3200.acr'
      )
    ).toBeTruthy()
    expect(pull).toHaveBeenCalledWith({ device: stick.id, id: 2100 })
    expect(echoed()).toContain(`ovd crash pull 2100 --device ${stick.id}`)
    expect(stub.api.crashes.pull).toHaveBeenCalledTimes(1)
    fireEvent.click(within(panel).getByRole('button', { name: 'Show in folder' }))
    expect(stub.api.crashes.reveal).toHaveBeenCalledWith({ device: stick.id, id: 2100 })
  })

  test('a failed pull toasts the error with the echo', async () => {
    renderScreen({
      crashes: {
        pull: async () => ({
          ok: false,
          error: { code: 'CRASH_PULL_FAILED', message: 'Couldn’t pull it', hint: 'Retry' }
        })
      }
    })
    const panel = await open()
    fireEvent.click(within(panel).getByRole('button', { name: 'Download ACR' }))
    expect(await screen.findByText('Couldn’t pull it')).toBeTruthy()
    expect(echoed()).toContain('ovd crash pull 2100')
  })

  test.each([
    ['Copy crash report path', 'copyPath', 'crash report path'],
    ['Copy prompt for your agent', 'copyPrompt', 'prompt for your agent']
  ] as const)(
    '%s copies in main, says if it downloaded first, and echoes',
    async (label, method, what) => {
      const copy = vi
        .fn<() => Promise<IpcResult<CrashCopied>>>()
        .mockResolvedValueOnce({ ok: true, data: { path: '/x/a.acr', downloaded: true } })
        .mockResolvedValueOnce({ ok: true, data: { path: '/x/a.acr', downloaded: false } })
      const stub = renderScreen({ crashes: { [method]: copy } })
      const panel = await open()
      fireEvent.click(within(panel).getByRole('button', { name: label }))
      expect(await screen.findByText(`Downloaded the report and copied the ${what}`)).toBeTruthy()
      expect(echoed()).toContain(`ovd crash pull 2100 --device ${stick.id}`)
      await waitFor(() =>
        expect(within(panel).getByRole('button', { name: label }).hasAttribute('disabled')).toBe(
          false
        )
      )
      fireEvent.click(within(panel).getByRole('button', { name: label }))
      expect(await screen.findByText(`Copied the ${what}`)).toBeTruthy()
      expect(stub.api.crashes[method]).toHaveBeenCalledWith({ device: stick.id, id: 2100 })
    }
  )

  test('the renderer sends only {device, id}', async () => {
    const stub = renderScreen({
      crashes: {
        copyPath: async () => ({ ok: true, data: { path: '/x/a.acr', downloaded: false } })
      }
    })
    const panel = await open()
    fireEvent.click(within(panel).getByRole('button', { name: 'Copy crash report path' }))
    await screen.findByText('Copied the crash report path')
    for (const call of vi.mocked(stub.api.crashes.copyPath).mock.calls) {
      expect(Object.keys(call[0]).sort()).toEqual(['device', 'id'])
    }
  })

  test('Logs at crash time hands the crash over', async () => {
    const onOpenLogs = vi.fn()
    renderScreen({ onOpenLogs })
    const panel = await open()
    fireEvent.click(within(panel).getByRole('button', { name: 'Logs at crash time' }))
    expect(onOpenLogs).toHaveBeenCalledWith(jsCrash)
  })
})

describe('an open request', () => {
  test('selects the crash once the list is read, and clears NEW', async () => {
    const onOpenHandled = vi.fn()
    renderScreen({ openRequest: { device: stick.id, id: 2100, n: 1 }, onOpenHandled })
    expect(await screen.findByRole('complementary', { name: 'Crash 2100 details' })).toBeTruthy()
    expect(onOpenHandled).toHaveBeenCalledTimes(1)
    expect(newCount(stick.id)).toBe(0)
  })

  test('a request for another device or a missing crash is dropped', async () => {
    const onOpenHandled = vi.fn()
    renderScreen({ openRequest: { device: stick.id, id: 9999, n: 1 }, onOpenHandled })
    await rowOf('com.example.player')
    await waitFor(() => expect(onOpenHandled).toHaveBeenCalled())
    expect(screen.queryByRole('complementary')).toBeNull()
  })
})
