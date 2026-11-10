import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PackageBuild } from '../../src/index.js'
import { watchBuilds } from '../../src/watch/buildWatcher.js'

const POLL = 1_000
const FOLDER = '/home/dev/dev/player'

// A build as `packages.builds` describes it (`build/<arch>-<type>/<name>_<arch>.vpkg`).
function build(
  arch: 'aarch64' | 'armv7' | 'x86_64',
  type: 'debug' | 'release',
  size: number,
  modifiedAt: string
): PackageBuild {
  const file = `player_${arch}.vpkg`
  return {
    path: `${FOLDER}/build/${arch}-${type}/${file}`,
    displayPath: `~/dev/player/build/${arch}-${type}/${file}`,
    file,
    folder: `build/${arch}-${type}/`,
    size,
    modifiedAt,
    folderArch: arch,
    folderBuildType: type
  }
}

const T0 = '2026-11-10T09:00:00.000Z'
const T1 = '2026-11-10T09:05:00.000Z'
const T2 = '2026-11-10T09:05:00.500Z'
const T3 = '2026-11-10T09:10:00.000Z'

// A folder whose builds a test sets between polls, and every batch the watcher emitted.
function setup(initial: PackageBuild[] = []) {
  let builds: PackageBuild[] | Error = initial
  const batches: PackageBuild[][] = []
  const scan = vi.fn(async () => {
    if (builds instanceof Error) throw builds
    return builds
  })
  const onSettled = vi.fn((batch: PackageBuild[]): void | Promise<void> => {
    batches.push(batch)
  })
  const watcher = watchBuilds({ scan, pollMs: POLL, onSettled })
  return {
    watcher,
    scan,
    onSettled,
    batches,
    set: (next: PackageBuild[] | Error) => (builds = next)
  }
}

const poll = (n = 1) => vi.advanceTimersByTimeAsync(POLL * n)

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('watchBuilds', () => {
  test('the builds there at the start are the baseline: nothing emits', async () => {
    const s = setup([build('aarch64', 'debug', 1_000, T0), build('armv7', 'release', 1_000, T0)])
    await s.watcher.ready
    await poll(5)
    expect(s.onSettled).not.toHaveBeenCalled()
    expect(s.scan.mock.calls.length).toBeGreaterThanOrEqual(5)
    s.watcher.stop()
  })

  test('a package still being written waits until its size and mtime held for a poll', async () => {
    const s = setup([build('aarch64', 'debug', 1_000, T0)])
    await s.watcher.ready
    // The copy is written in place, incrementally (ARCHITECTURE §8).
    s.set([build('aarch64', 'debug', 400, T1)])
    await poll()
    s.set([build('aarch64', 'debug', 1_200, T2)])
    await poll()
    expect(s.onSettled).not.toHaveBeenCalled()
    await poll()
    expect(s.batches).toEqual([[build('aarch64', 'debug', 1_200, T2)]])
    await poll(3)
    expect(s.onSettled).toHaveBeenCalledTimes(1)
    s.watcher.stop()
  })

  test('several packages written in turn settle as one batch, newest first', async () => {
    const s = setup([build('aarch64', 'debug', 1_000, T0), build('armv7', 'debug', 1_000, T0)])
    await s.watcher.ready
    s.set([build('aarch64', 'debug', 1_000, T1), build('armv7', 'debug', 1_000, T0)])
    await poll()
    s.set([build('aarch64', 'debug', 1_000, T1), build('armv7', 'debug', 1_000, T2)])
    await poll()
    await poll()
    expect(s.batches).toEqual([
      [build('armv7', 'debug', 1_000, T2), build('aarch64', 'debug', 1_000, T1)]
    ])
    s.watcher.stop()
  })

  test('two rebuilds are two batches', async () => {
    const s = setup([build('aarch64', 'debug', 1_000, T0)])
    await s.watcher.ready
    s.set([build('aarch64', 'debug', 1_000, T1)])
    await poll(2)
    s.set([build('aarch64', 'debug', 1_000, T3)])
    await poll(2)
    expect(s.batches).toEqual([
      [build('aarch64', 'debug', 1_000, T1)],
      [build('aarch64', 'debug', 1_000, T3)]
    ])
    s.watcher.stop()
  })

  test('build/ removed by a clean and written again: one batch with the new file', async () => {
    const s = setup([build('aarch64', 'debug', 1_000, T0)])
    await s.watcher.ready
    s.set([])
    await poll(3)
    expect(s.onSettled).not.toHaveBeenCalled()
    s.set([build('aarch64', 'debug', 1_000, T1)])
    await poll(2)
    expect(s.batches).toEqual([[build('aarch64', 'debug', 1_000, T1)]])
    s.watcher.stop()
  })

  test('a package deleted while pending is dropped', async () => {
    const s = setup()
    await s.watcher.ready
    s.set([build('aarch64', 'debug', 400, T1)])
    await poll()
    s.set([])
    await poll(3)
    expect(s.onSettled).not.toHaveBeenCalled()
    s.watcher.stop()
  })

  test('no build/ yet: the first build that appears is one batch', async () => {
    const s = setup([])
    await s.watcher.ready
    await poll(2)
    s.set([build('aarch64', 'debug', 1_000, T1)])
    await poll(2)
    expect(s.batches).toEqual([[build('aarch64', 'debug', 1_000, T1)]])
    s.watcher.stop()
  })

  test('a scan that fails is a poll with no change', async () => {
    const s = setup([build('aarch64', 'debug', 1_000, T0)])
    await s.watcher.ready
    s.set(new Error('EACCES'))
    await poll(3)
    expect(s.onSettled).not.toHaveBeenCalled()
    // The baseline is kept: the same builds don't count as new once the scan works again.
    s.set([build('aarch64', 'debug', 1_000, T0)])
    await poll(3)
    expect(s.onSettled).not.toHaveBeenCalled()
    s.set([build('aarch64', 'debug', 1_000, T1)])
    await poll(2)
    expect(s.batches).toHaveLength(1)
    s.watcher.stop()
  })

  test('the next poll waits for the batch callback; changes meanwhile come next', async () => {
    let release = (): void => undefined
    const s = setup([build('aarch64', 'debug', 1_000, T0)])
    s.onSettled.mockImplementationOnce(
      (batch: PackageBuild[]) =>
        new Promise<void>((resolve) => {
          s.batches.push(batch)
          release = resolve
        })
    )
    await s.watcher.ready
    s.set([build('aarch64', 'debug', 1_000, T1)])
    await poll(2)
    expect(s.onSettled).toHaveBeenCalledTimes(1)
    const scans = s.scan.mock.calls.length
    s.set([build('aarch64', 'debug', 1_000, T3)])
    await poll(5)
    expect(s.scan.mock.calls.length).toBe(scans)
    release()
    await poll(2)
    expect(s.batches).toEqual([
      [build('aarch64', 'debug', 1_000, T1)],
      [build('aarch64', 'debug', 1_000, T3)]
    ])
    s.watcher.stop()
  })

  test('stop ends polling', async () => {
    const s = setup()
    await s.watcher.ready
    s.watcher.stop()
    const scans = s.scan.mock.calls.length
    await poll(5)
    expect(s.scan.mock.calls.length).toBe(scans)
  })
})
