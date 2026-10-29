import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createDevicesWatcher,
  OvdError,
  type DevicesSnapshot,
  type DevicesUpdate
} from '../../src/index.js'

const empty: DevicesSnapshot = { devices: [], target: null }
const withTarget: DevicesSnapshot = { devices: [], target: 'VirtualDevice' }

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function watch(list: () => Promise<DevicesSnapshot>) {
  const updates: DevicesUpdate[] = []
  const watcher = createDevicesWatcher({ list, onUpdate: (u) => updates.push(u) })
  return { watcher, updates }
}

describe('createDevicesWatcher', () => {
  test('polls at once and every 2 s, emitting only changes', async () => {
    const list = vi
      .fn<() => Promise<DevicesSnapshot>>()
      .mockResolvedValueOnce(empty)
      .mockResolvedValueOnce(empty)
      .mockResolvedValue(withTarget)
    const { watcher, updates } = watch(list)
    watcher.start()
    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(updates).toEqual([{ ok: true, ...empty }])
    await vi.advanceTimersByTimeAsync(2000)
    expect(list).toHaveBeenCalledTimes(2)
    expect(updates).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(updates.at(-1)).toEqual({ ok: true, ...withTarget })
    watcher.stop()
  })

  test('a repeating error is emitted once; other errors become COMMAND_FAILED', async () => {
    const list = vi
      .fn<() => Promise<DevicesSnapshot>>()
      .mockRejectedValueOnce(new OvdError('VDA_UNAVAILABLE', 'VDA is not available', 'Check'))
      .mockRejectedValueOnce(new OvdError('VDA_UNAVAILABLE', 'VDA is not available', 'Check'))
      .mockRejectedValue(new Error('boom'))
    const { watcher, updates } = watch(list)
    watcher.start()
    await vi.advanceTimersByTimeAsync(4000)
    expect(updates).toEqual([
      {
        ok: false,
        error: { code: 'VDA_UNAVAILABLE', message: 'VDA is not available', hint: 'Check' }
      },
      { ok: false, error: expect.objectContaining({ code: 'COMMAND_FAILED', message: 'boom' }) }
    ])
    watcher.stop()
  })

  test('a slow poll never overlaps the next one', async () => {
    const list = vi.fn(
      () => new Promise<DevicesSnapshot>((resolve) => setTimeout(() => resolve(empty), 5000))
    )
    const { watcher } = watch(list)
    watcher.start()
    await vi.advanceTimersByTimeAsync(4999)
    expect(list).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await vi.advanceTimersByTimeAsync(1999)
    expect(list).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(list).toHaveBeenCalledTimes(2)
    watcher.stop()
  })

  test('nothing is emitted after stop, even from a poll in flight', async () => {
    const list = vi.fn(
      () => new Promise<DevicesSnapshot>((resolve) => setTimeout(() => resolve(empty), 1000))
    )
    const { watcher, updates } = watch(list)
    watcher.start()
    watcher.stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(updates).toEqual([])
    expect(list).toHaveBeenCalledTimes(1)
  })

  test('refresh works while stopped and runs after a poll in flight', async () => {
    let n = 0
    const list = vi.fn(
      () =>
        new Promise<DevicesSnapshot>((resolve) =>
          setTimeout(() => resolve(n++ === 0 ? empty : withTarget), 100)
        )
    )
    const { watcher, updates } = watch(list)
    const refreshed = watcher.refresh()
    await vi.advanceTimersByTimeAsync(100)
    expect(await refreshed).toEqual({ ok: true, ...empty })

    watcher.start()
    const second = watcher.refresh()
    await vi.advanceTimersByTimeAsync(200)
    expect(await second).toEqual({ ok: true, ...withTarget })
    expect(list).toHaveBeenCalledTimes(3)
    expect(updates).toEqual([
      { ok: true, ...empty },
      { ok: true, ...withTarget }
    ])
    watcher.stop()
  })
})
