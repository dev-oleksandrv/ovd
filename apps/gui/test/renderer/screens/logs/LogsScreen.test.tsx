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
import { ROW_HEIGHT } from '../../../../src/renderer/src/screens/logs/LogRow'
import { entries, logEntry } from './sample'

const running: LogsState = {
  status: 'running',
  device: stick.id,
  name: stick.name,
  startedAt: '2026-11-08T07:27:00.000Z',
  restartAfterInstall: true
}
const counts = (lines: number, errors = 0, shown = lines, oldest?: string) => ({
  lines,
  errors,
  shown,
  ...(oldest === undefined ? {} : { oldest })
})

afterEach(() => {
  vi.useRealTimers()
})

async function renderScreen(
  opts: {
    devices?: Device[]
    logs?: Parameters<typeof stubOvd>[0]['logs']
    exportRequest?: { format: 'text' | 'jsonl'; n: number }
    onExportHandled?: () => void
    crashRequest?: { n: number; app: string; time: string }
    onCrashRequestHandled?: () => void
  } = {}
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
        <LogsScreen
          onSwitchTarget={() => undefined}
          projectAppId={null}
          {...(opts.exportRequest ? { exportRequest: opts.exportRequest } : {})}
          {...(opts.onExportHandled ? { onExportHandled: opts.onExportHandled } : {})}
          {...(opts.crashRequest ? { crashRequest: opts.crashRequest } : {})}
          {...(opts.onCrashRequestHandled
            ? { onCrashRequestHandled: opts.onCrashRequestHandled }
            : {})}
        />
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

  test('a session that ended with restart after install off: the error command carries --no-restart-after-install', async () => {
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
        restartAfterInstall: false
      }
    })
    expect(
      screen.getByText(`$ ovd logs --no-restart-after-install --device ${stick.id}`)
    ).toBeTruthy()
  })

  test('a session that opens straight into reconnecting echoes the CLI once', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    push(stub, {
      kind: 'state',
      session: 1,
      state: { ...running, status: 'reconnecting', restartAfterInstall: false }
    })
    await waitFor(() =>
      expect(echoed()).toContain(`ovd logs --no-restart-after-install --device ${stick.id}`)
    )
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

  test('Export → Plain text saves the shown lines and says where, with the CLI echo', async () => {
    const stub = await renderScreen({
      logs: {
        export: async () => ({
          ok: true,
          data: {
            status: 'saved',
            path: '/home/dev/ovd-logs.txt',
            format: 'text',
            lines: 3,
            until: '2026-11-08T07:27:00.257Z',
            replaced: false
          }
        })
      }
    })
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Plain text (.txt)' }))
    expect(await screen.findByText('Exported 3 lines to /home/dev/ovd-logs.txt')).toBeTruthy()
    expect(stub.api.logs.export).toHaveBeenCalledWith({ format: 'text' })
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() =>
      expect(echoed()).toContain(
        `ovd logs --until 2026-11-08T07:27:00.257Z --export /home/dev/ovd-logs.txt --device ${stick.id}`
      )
    )
  })

  test('Export → JSON lines while paused exports up to the pause; a replaced file echoes --force', async () => {
    const stub = await renderScreen({
      logs: {
        export: async () => ({
          ok: true,
          data: {
            status: 'saved',
            path: '/home/dev/player.jsonl',
            format: 'jsonl',
            lines: 3,
            until: '2026-11-08T07:27:00.257Z',
            replaced: true
          }
        })
      }
    })
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    fireEvent.click(screen.getByRole('button', { name: /Pause/ }))
    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'JSON lines (.jsonl)' }))
    expect(await screen.findByText('Exported 3 lines to /home/dev/player.jsonl')).toBeTruthy()
    expect(stub.api.logs.export).toHaveBeenCalledWith({ format: 'jsonl', throughSeq: 2 })
    await waitFor(() =>
      expect(echoed()).toContain(
        `ovd logs --until 2026-11-08T07:27:00.257Z --export /home/dev/player.jsonl --format jsonl --force --device ${stick.id}`
      )
    )
  })

  test('Export with nothing shown: "No log lines to export"', async () => {
    const stub = await renderScreen({
      logs: { export: async () => ({ ok: true, data: { status: 'empty' } }) }
    })
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Plain text (.txt)' }))
    expect(await screen.findByText('No log lines to export')).toBeTruthy()
  })

  test('a failed export shows the error with the CLI echo', async () => {
    const stub = await renderScreen({
      logs: {
        export: async () => ({
          ok: false,
          error: {
            code: 'EXPORT_FAILED',
            message: 'Can’t write /home/dev/ro/ovd-logs.txt (EACCES)',
            hint: 'Check that you can write to the folder'
          }
        })
      }
    })
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Plain text (.txt)' }))
    expect(await screen.findByText('Can’t write /home/dev/ro/ovd-logs.txt (EACCES)')).toBeTruthy()
    await waitFor(() => expect(echoed()).toContain(`ovd logs --device ${stick.id}`))
  })

  test('a palette export waits while the session starts, then runs once', async () => {
    const onExportHandled = vi.fn()
    const stub = await renderScreen({
      exportRequest: { format: 'jsonl', n: 1 },
      onExportHandled,
      logs: { export: async () => ({ ok: true, data: { status: 'canceled' } }) }
    })
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    push(stub, {
      kind: 'state',
      session: 1,
      state: { status: 'starting', device: stick.id, name: stick.name, restartAfterInstall: true }
    })
    expect(stub.api.logs.export).not.toHaveBeenCalled()
    start(stub)
    await waitFor(() => expect(stub.api.logs.export).toHaveBeenCalledWith({ format: 'jsonl' }))
    expect(onExportHandled).toHaveBeenCalledTimes(1)
    push(stub, { kind: 'append', session: 1, entries: [logEntry(3)], counts: counts(4), apps: [] })
    expect(stub.api.logs.export).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['no target', []],
    ['an offline target', [{ ...stick, status: 'offline' as const }]]
  ])('a palette export with %s: "No log lines to export", no save dialog', async (_n, devices) => {
    const onExportHandled = vi.fn()
    const stub = await renderScreen({
      devices,
      exportRequest: { format: 'text', n: 1 },
      onExportHandled
    })
    expect(await screen.findByText('No log lines to export')).toBeTruthy()
    expect(onExportHandled).toHaveBeenCalledTimes(1)
    expect(stub.api.logs.export).not.toHaveBeenCalled()
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
  test('an ended session on an offline target: the offline state with why it ended, no Restart', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    act(() => stub.push(ready([{ ...stick, status: 'offline' }], stick.id)))
    push(stub, {
      kind: 'state',
      session: 1,
      state: {
        ...running,
        status: 'ended',
        error: { code: 'LOG_STREAM_ENDED', message: 'Fire TV stick stayed away', hint: 'h' }
      }
    })
    expect(await screen.findByText('Logs unavailable — Fire TV stick is offline')).toBeTruthy()
    expect(screen.getByText('The last log session ended: Fire TV stick stayed away')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Restart' })).toBeNull()
    expect(screen.queryByText('[KeplerScript-JavaScript] player flood 0')).toBeNull()
    // The target is back: the ended session shows again, with its lines and Restart.
    act(() => stub.push(ready([stick], stick.id)))
    expect(await screen.findByRole('button', { name: 'Restart' })).toBeTruthy()
    expect(screen.getByText('[KeplerScript-JavaScript] player flood 0')).toBeTruthy()
  })

  test('no target while main keeps the session reconnecting: the list, the note and the echo stay', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    act(() => stub.push(ready([], null)))
    push(stub, { kind: 'state', session: 1, state: { ...running, status: 'reconnecting' } })
    expect(screen.getByRole('status').textContent).toContain('Reconnecting to Fire TV stick…')
    expect(screen.getByText('[KeplerScript-JavaScript] player flood 2')).toBeTruthy()
    expect(screen.queryByText('No target device')).toBeNull()
    expect(screen.getByText('Live log of Fire TV stick · filtered on this computer')).toBeTruthy()
    expect(echoed()).toContain(`ovd logs --device ${stick.id}`)
  })

  test('no target and no live session: a call to choose one', async () => {
    const stub = await renderScreen()
    await waitFor(() => expect(stub.api.logs.open).toHaveBeenCalled())
    start(stub)
    act(() => stub.push(ready([], null)))
    push(stub, {
      kind: 'state',
      session: 1,
      state: {
        ...running,
        status: 'ended',
        error: { code: 'LOG_STREAM_ENDED', message: 'ended', hint: 'h' }
      }
    })
    expect(await screen.findByText('No target device')).toBeTruthy()
  })
})

describe('Logs at crash time', () => {
  const timed = (n: number) =>
    entries(n).map((e) =>
      logEntry(e.seq, { time: `2026-11-08T07:28:${String(e.seq).padStart(2, '0')}.000Z` })
    )
  const request = { n: 1, app: 'com.example.player', time: '2026-11-08T07:28:30.000Z' }

  test('filters on the crash’s app and scrolls to the crash time when the session covers it', async () => {
    const stub = await renderScreen({ crashRequest: request })
    push(stub, { kind: 'state', session: 1, state: running })
    push(stub, {
      kind: 'reset',
      session: 1,
      entries: timed(50),
      counts: counts(50, 0, 50, '2026-11-08T07:28:00.000Z'),
      apps: ['com.example.player']
    })
    await waitFor(() =>
      expect(stub.api.logs.setFilter).toHaveBeenCalledWith({ app: 'com.example.player' })
    )
    const list = await screen.findByRole('list', { name: 'Log lines' })
    await waitFor(() => expect(list.scrollTop).toBe(30 * ROW_HEIGHT))
    expect(screen.queryByText(/journal rotates fast/)).toBeNull()
  })

  test('says the journal rotates fast when the retained history starts after the crash', async () => {
    const stub = await renderScreen({
      crashRequest: { ...request, time: '2026-11-08T07:00:00.000Z' }
    })
    push(stub, { kind: 'state', session: 1, state: running })
    push(stub, {
      kind: 'reset',
      session: 1,
      entries: timed(5),
      counts: counts(5, 0, 5, '2026-11-08T07:28:00.000Z'),
      apps: ['com.example.player']
    })
    expect(await screen.findByText(/journal rotates fast/)).toBeTruthy()
    expect(screen.getByText(/start logs \(or use Run\) before launching the app/)).toBeTruthy()
    expect(stub.api.logs.setFilter).toHaveBeenCalledWith({ app: 'com.example.player' })
  })

  const pushAndResolve = async (c: ReturnType<typeof counts>, lines = timed(50)) => {
    const stub = await renderScreen({ crashRequest: request })
    push(stub, { kind: 'state', session: 1, state: running })
    push(stub, {
      kind: 'reset',
      session: 1,
      entries: lines,
      counts: c,
      apps: ['com.example.player']
    })
    return stub
  }

  test('a full buffer (over 100,000 lines received) still scrolls when the oldest retained line is before the crash', async () => {
    await pushAndResolve(counts(150_000, 0, 50, '2026-11-08T07:28:00.000Z'))
    const list = await screen.findByRole('list', { name: 'Log lines' })
    await waitFor(() => expect(list.scrollTop).toBe(30 * ROW_HEIGHT))
    expect(screen.queryByText(/journal rotates fast/)).toBeNull()
  })

  test('after Clear it does not claim coverage', async () => {
    await pushAndResolve(counts(0), [])
    expect(await screen.findByText(/journal rotates fast/)).toBeTruthy()
  })

  test('after the oldest lines were evicted past the crash it does not claim coverage', async () => {
    await pushAndResolve(counts(90_000, 0, 20, '2026-11-08T07:28:40.000Z'), timed(50).slice(40))
    expect(await screen.findByText(/journal rotates fast/)).toBeTruthy()
  })

  test('waits for the session, then runs once and tells its parent', async () => {
    const onCrashRequestHandled = vi.fn()
    const stub = await renderScreen({ crashRequest: request, onCrashRequestHandled })
    await screen.findByText(/Starting the log session/)
    expect(onCrashRequestHandled).not.toHaveBeenCalled()
    start(stub)
    await waitFor(() => expect(onCrashRequestHandled).toHaveBeenCalledTimes(1))
    expect(stub.api.logs.setFilter).toHaveBeenCalledTimes(1)
  })
})
