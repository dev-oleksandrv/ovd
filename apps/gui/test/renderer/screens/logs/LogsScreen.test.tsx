import type { Device } from '@ovd/core'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { LogsState, LogsUpdate } from '../../../../src/preload/api'
import { DevicesProvider } from '../../../../src/renderer/src/devices/DevicesProvider'
import { FeedbackProvider } from '../../../../src/renderer/src/feedback/FeedbackProvider'
import { ToastViewport } from '../../../../src/renderer/src/feedback/ToastViewport'
import { StatusBar } from '../../../../src/renderer/src/frame/StatusBar'
import { LogsScreen } from '../../../../src/renderer/src/screens/logs/LogsScreen'
import { ready, stubOvd, type OvdStub } from '../../support/ovdStub'
import { stick } from '../devices/sample'
import { entries, logEntry } from './sample'

const running: LogsState = {
  status: 'running',
  device: stick.id,
  name: stick.name,
  startedAt: '2026-11-08T07:27:00.000Z',
  restartAfterInstall: true
}
const counts = (lines: number, errors = 0, shown = lines) => ({ lines, errors, shown })

afterEach(() => {
  vi.useRealTimers()
})

async function renderScreen(
  opts: { devices?: Device[]; logs?: Parameters<typeof stubOvd>[0]['logs'] } = {}
): Promise<OvdStub> {
  const devices = opts.devices ?? [stick]
  const stub = stubOvd({
    list: async () => ready(devices, devices[0]?.id ?? null),
    devices,
    ...(opts.logs ? { logs: opts.logs } : {})
  })
  render(
    <FeedbackProvider>
      <DevicesProvider>
        <LogsScreen onSwitchTarget={() => undefined} projectAppId={null} />
      </DevicesProvider>
      <StatusBar />
      <ToastViewport />
    </FeedbackProvider>
  )
  return stub
}

// Pushes what main sends once a session for the stick runs.
function start(stub: OvdStub, n = 3): void {
  push(stub, { kind: 'state', session: 1, state: running })
  push(stub, {
    kind: 'reset',
    session: 1,
    entries: entries(n),
    counts: counts(n),
    apps: ['com.example.player']
  })
}

function push(stub: OvdStub, update: LogsUpdate): void {
  act(() => stub.pushLogs(update))
}

const echoed = () => screen.getByTitle('Copy CLI equivalent').textContent ?? ''

describe('LogsScreen', () => {
  test('no target: a call to choose one, no session', async () => {
    const stub = await renderScreen({ devices: [] })
    expect(await screen.findByText('No target device')).toBeTruthy()
    expect(stub.api.logs.open).not.toHaveBeenCalled()
  })

  test('an offline target: Logs unavailable, no session', async () => {
    const stub = await renderScreen({ devices: [{ ...stick, status: 'offline' }] })
    expect(await screen.findByText('Logs unavailable — Fire TV stick is offline')).toBeTruthy()
    expect(stub.api.logs.open).not.toHaveBeenCalled()
  })

  test('opens the session for the online target and shows it starting', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalledWith(stick.id))
    expect(screen.getByText('Starting the log session on Fire TV stick…')).toBeTruthy()
  })

  test('rows show once it runs, with the CLI echo', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    expect(screen.getByText('[KeplerScript-JavaScript] player flood 2')).toBeTruthy()
    expect(echoed()).toContain(`ovd logs --device ${stick.id}`)
    expect(screen.getByText('3 lines · 0 errors')).toBeTruthy()
    expect(screen.getByText('Fire TV stick · since', { exact: false })).toBeTruthy()
  })

  test('running with no lines yet: waiting', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub, 0)
    expect(screen.getByText('Waiting for log lines from Fire TV stick')).toBeTruthy()
  })

  test('a stream that ended with no lines: the error with Restart', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    push(stub, {
      kind: 'state',
      session: 1,
      state: {
        status: 'ended',
        device: stick.id,
        name: stick.name,
        startedAt: null,
        error: {
          code: 'LOG_STREAM_ENDED',
          message: 'Fire TV stick’s log stream ended',
          hint: 'The device may have disconnected or rebooted'
        },
        restartAfterInstall: true
      }
    })
    expect(screen.getByRole('alert').textContent).toContain('Fire TV stick’s log stream ended')
    expect(screen.getByText(`$ ovd logs --device ${stick.id}`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await waitFor(() => expect(stub.api.logs.restart).toHaveBeenCalledWith(stick.id))
  })

  test('a stream that ended with lines keeps them under the error', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    push(stub, {
      kind: 'state',
      session: 1,
      state: {
        ...running,
        status: 'ended',
        error: { code: 'LOG_STREAM_ENDED', message: 'Fire TV stick’s log stream ended', hint: 'h' }
      }
    })
    expect(screen.getByRole('alert').textContent).toContain('log stream ended')
    expect(screen.getByText('[KeplerScript-JavaScript] player flood 0')).toBeTruthy()
  })

  test('lines that all miss the filter: "No lines match", and Clear filters resets them', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    push(stub, { kind: 'state', session: 1, state: running })
    push(stub, { kind: 'reset', session: 1, entries: [], counts: counts(0), apps: [] })
    push(stub, { kind: 'append', session: 1, entries: [], counts: counts(12, 2, 0), apps: [] })
    expect(screen.getByText('No lines match the filters')).toBeTruthy()
    expect(screen.getByText('12 lines · 2 errors')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(stub.api.logs.setFilter).toHaveBeenLastCalledWith({}))
  })

  test('the footer counts follow an append with no entries', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    push(stub, { kind: 'append', session: 1, entries: [], counts: counts(40, 1, 3), apps: [] })
    expect(screen.getByText('40 lines · 1 error')).toBeTruthy()
  })

  test('a level change filters in main and echoes the CLI', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    fireEvent.click(screen.getByRole('radio', { name: 'Error' }))
    await waitFor(() => expect(stub.api.logs.setFilter).toHaveBeenCalledWith({ level: 'e' }))
    await waitFor(() => expect(echoed()).toContain(`ovd logs --level error --device ${stick.id}`))
  })

  test('the package filter passes the app', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    fireEvent.change(screen.getByRole('combobox', { name: 'Package' }), {
      target: { value: 'com.example.player' }
    })
    await waitFor(() =>
      expect(stub.api.logs.setFilter).toHaveBeenCalledWith({ app: 'com.example.player' })
    )
  })

  test('search waits 300 ms after typing stops', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const field = screen.getByRole('textbox', { name: 'Search logs' })
    fireEvent.change(field, { target: { value: 'tic' } })
    act(() => vi.advanceTimersByTime(200))
    fireEvent.change(field, { target: { value: 'tick' } })
    act(() => vi.advanceTimersByTime(299))
    expect(stub.api.logs.setFilter).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(1))
    expect(stub.api.logs.setFilter).toHaveBeenCalledTimes(1)
    expect(stub.api.logs.setFilter).toHaveBeenCalledWith({ search: 'tick' })
  })

  test('an invalid regex shows inline and changes nothing', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    fireEvent.click(screen.getByRole('button', { name: 'Regex' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search logs' }), {
      target: { value: '(' }
    })
    expect(await screen.findByText(/Invalid regular expression/)).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(stub.api.logs.setFilter).not.toHaveBeenCalled()
  })

  test('Pause freezes the list and counts new lines; clicking them resumes', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    fireEvent.click(screen.getByRole('button', { name: /Pause/ }))
    push(stub, {
      kind: 'append',
      session: 1,
      entries: [logEntry(3), logEntry(4)],
      counts: counts(5),
      apps: []
    })
    expect(screen.queryByText('[KeplerScript-JavaScript] player flood 4')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '2 new lines' }))
    expect(screen.getByText('[KeplerScript-JavaScript] player flood 4')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Pause/ })).toBeTruthy()
  })

  test('Clear asks main to clear', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    fireEvent.click(screen.getByRole('button', { name: /Clear/ }))
    expect(stub.api.logs.clear).toHaveBeenCalled()
  })

  test('Export saves the shown lines and says where', async () => {
    const stub = await renderScreen({
      logs: {
        export: async () => ({
          ok: true,
          data: { path: '/home/dev/ovd-logs.txt', lines: 3 }
        })
      }
    })
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    expect(await screen.findByText('Exported 3 lines to /home/dev/ovd-logs.txt')).toBeTruthy()
    expect(stub.api.logs.export).toHaveBeenCalledWith(undefined)
  })

  test('the footer toggle turns restart after install off and the echo carries --no-restart-after-install', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    const toggle = screen.getByRole('button', { name: 'Restart session after install' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    await waitFor(() => expect(stub.api.logs.setRestartAfterInstall).toHaveBeenCalledWith(false))
    expect(await screen.findByText('Restart session after install: off')).toBeTruthy()
    await waitFor(() =>
      expect(echoed()).toContain(`ovd logs --no-restart-after-install --device ${stick.id}`)
    )
    // Main pushes the state with the new value.
    push(stub, { kind: 'state', session: 1, state: { ...running, restartAfterInstall: false } })
    expect(
      screen
        .getByRole('button', { name: 'Restart session after install' })
        .getAttribute('aria-pressed')
    ).toBe('false')
  })

  test('reconnecting: the note shows above the list and the list stays while the target shows offline, then goes once it runs', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    push(stub, { kind: 'state', session: 1, state: { ...running, status: 'reconnecting' } })
    act(() => stub.push(ready([{ ...stick, status: 'offline' }], stick.id)))
    const note = screen.getByRole('status')
    expect(note.textContent).toContain('Reconnecting to Fire TV stick…')
    expect(note.textContent).toContain('The device dropped. Lines continue here once it’s back.')
    expect(screen.getByText('[KeplerScript-JavaScript] player flood 2')).toBeTruthy()
    expect(screen.queryByText('Logs unavailable — Fire TV stick is offline')).toBeNull()
    act(() => stub.push(ready([stick], stick.id)))
    push(stub, { kind: 'state', session: 1, state: running })
    expect(screen.queryByText('Reconnecting to Fire TV stick…')).toBeNull()
    expect(screen.getByText('[KeplerScript-JavaScript] player flood 2')).toBeTruthy()
  })

  test('a running session keeps the list while the target shows offline', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    act(() => stub.push(ready([{ ...stick, status: 'offline' }], stick.id)))
    await waitFor(() => expect(screen.getByText('3 lines · 0 errors')).toBeTruthy())
    expect(screen.getByText('[KeplerScript-JavaScript] player flood 0')).toBeTruthy()
    expect(screen.queryByText('Logs unavailable — Fire TV stick is offline')).toBeNull()
    expect(screen.getByRole('button', { name: /Pause/ })).toBeTruthy()
  })
})
