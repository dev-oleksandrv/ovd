// @vitest-environment node
import { EventEmitter } from 'node:events'
import { createCrashWatch, type Crash, type CrashWatchOptions } from '@ovd/core'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createCrashWatcher, type VisibilityWindow } from '../../src/main/crashWatcher'

class FakeWindow extends EventEmitter implements VisibilityWindow {
  visible = true
  minimized = false
  destroyed = false
  isVisible = () => this.visible
  isMinimized = () => this.minimized
  isDestroyed = () => this.destroyed
}

const device = { id: 'VirtualDevice', name: 'Vega Virtual Device' }
const crash: Crash = {
  id: 7,
  package: 'com.example.player',
  kind: 'js',
  signal: 6,
  pid: 3200,
  time: '2026-11-13T10:00:00.000Z',
  summary: 'Error: boom',
  new: true
}

describe('createCrashWatcher with a fake core watch', () => {
  function setup(win = new FakeWindow()) {
    const stops: Array<() => void> = []
    const opts: CrashWatchOptions[] = []
    const send = vi.fn()
    const watcher = createCrashWatcher({
      watch: (o) => {
        opts.push(o)
        const stop = vi.fn()
        stops.push(stop)
        return { stop }
      },
      send
    })
    watcher.watch(win)
    return { win, watcher, stops, opts, send }
  }

  test('starts for a visible window and pushes each new report with its device', () => {
    const { opts, send } = setup()
    expect(opts).toHaveLength(1)
    expect(opts[0]?.device).toBeUndefined()
    opts[0]?.onNew(crash, device)
    expect(send).toHaveBeenCalledWith({ device, crash })
  })

  test('does not start while hidden or minimized', () => {
    const win = new FakeWindow()
    win.visible = false
    expect(setup(win).opts).toHaveLength(0)
    const min = new FakeWindow()
    min.minimized = true
    expect(setup(min).opts).toHaveLength(0)
  })

  test('stops on hide and minimize, starts again on show and restore', () => {
    const { win, stops, opts, watcher } = setup()
    win.visible = false
    win.emit('hide')
    expect(stops[0]).toHaveBeenCalledTimes(1)
    expect(watcher.running()).toBe(false)
    win.visible = true
    win.emit('show')
    expect(opts).toHaveLength(2)
    win.minimized = true
    win.emit('minimize')
    expect(stops[1]).toHaveBeenCalledTimes(1)
    win.minimized = false
    win.emit('restore')
    expect(opts).toHaveLength(3)
    expect(watcher.running()).toBe(true)
  })

  test('a repeated event does not start a second watch', () => {
    const { win, opts } = setup()
    win.emit('show')
    win.emit('restore')
    expect(opts).toHaveLength(1)
  })

  test('stops when the window closes', () => {
    const { win, stops, watcher } = setup()
    win.emit('closed')
    expect(stops[0]).toHaveBeenCalledTimes(1)
    expect(watcher.running()).toBe(false)
  })
})

describe('polling stops while the window is hidden (real core watch, fake timers)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('no vault read is made while hidden or minimized', async () => {
    const scan = vi.fn(async () => ({
      entries: [],
      isNew: () => false,
      isAnnounced: () => false,
      markAnnounced: () => undefined
    }))
    const online = { id: device.id, name: device.name, status: 'online' }
    const deps = {
      reader: { scan },
      devices: { currentTarget: async () => ({ device: online }) },
      activity: { append: async () => undefined }
    } as unknown as Parameters<typeof createCrashWatch>[0]
    const win = new FakeWindow()
    const watcher = createCrashWatcher({
      watch: (o) => createCrashWatch(deps, { ...o, intervalMs: 5_000 }),
      send: () => undefined
    })
    watcher.watch(win)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(scan).toHaveBeenCalledTimes(3)

    win.visible = false
    win.emit('hide')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(scan).toHaveBeenCalledTimes(3)

    win.visible = true
    win.emit('show')
    await vi.advanceTimersByTimeAsync(0)
    expect(scan).toHaveBeenCalledTimes(4)

    win.minimized = true
    win.emit('minimize')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(scan).toHaveBeenCalledTimes(4)
    watcher.stop()
  })
})
