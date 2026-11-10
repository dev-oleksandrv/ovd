import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { PackageBuild, PrivateBuild } from '../../src/index.js'
import { BUILD_QUIET_MS, watchBuilds } from '../../src/watch/buildWatcher.js'

const POLL = 1_000
const FOLDER = '/home/dev/dev/player'
type Arch = 'aarch64' | 'armv7' | 'x86_64'

// A build as `packages.builds` describes it (`build/<arch>-<type>/<name>_<arch>.vpkg`).
function build(
  arch: Arch,
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

// The package `react-native build-vega` packs before it copies it (ARCHITECTURE §8).
function packed(arch: Arch, modifiedAt: string, size = 1_000): PrivateBuild {
  return {
    path: `${FOLDER}/build/private/kepler/@amazon-devices/player/undefined/vega/${arch}/Debug/@amazon-devices/player_${arch}.vpkg`,
    size,
    modifiedAt,
    arch,
    buildType: 'debug'
  }
}

const T0 = '2026-11-10T09:00:00.000Z'
const T1 = '2026-11-10T09:05:00.000Z'
const T2 = '2026-11-10T09:05:00.500Z'
const T3 = '2026-11-10T09:10:00.000Z'
const at = (s: number) => new Date(Date.parse(T1) + s * 1_000).toISOString()

// A folder whose builds (public and, with `privates`, private) a test sets between polls, and
// every batch the watcher emitted.
function setup(initial: PackageBuild[] = [], privates?: PrivateBuild[]) {
  let builds: PackageBuild[] | Error = initial
  let inPrivate: PrivateBuild[] = privates ?? []
  const batches: PackageBuild[][] = []
  const scan = vi.fn(async () => {
    if (builds instanceof Error) throw builds
    return builds
  })
  const onSettled = vi.fn((batch: PackageBuild[]): void | Promise<void> => {
    batches.push(batch)
  })
  const watcher = watchBuilds({
    scan,
    ...(privates ? { scanPrivate: async () => inPrivate } : {}),
    pollMs: POLL,
    onSettled
  })
  return {
    watcher,
    scan,
    onSettled,
    batches,
    set: (next: PackageBuild[] | Error) => (builds = next),
    setPrivate: (next: PrivateBuild[]) => (inPrivate = next)
  }
}

const poll = (n = 1) => vi.advanceTimersByTimeAsync(POLL * n)
// The poll that sees a change, then BUILD_QUIET_MS without one.
const settle = () => poll(1 + BUILD_QUIET_MS / POLL)

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

  test('a package still being written waits until it held, then 2 s of quiet', async () => {
    const s = setup([build('aarch64', 'debug', 1_000, T0)])
    await s.watcher.ready
    // The copy is written in place, incrementally (ARCHITECTURE §8).
    s.set([build('aarch64', 'debug', 400, T1)])
    await poll()
    s.set([build('aarch64', 'debug', 1_200, T2)])
    await poll()
    // Held for one poll, but not yet quiet for 2 s.
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
    await settle()
    expect(s.batches).toEqual([
      [build('armv7', 'debug', 1_000, T2), build('aarch64', 'debug', 1_000, T1)]
    ])
    s.watcher.stop()
  })

  test('two rebuilds are two batches', async () => {
    const s = setup([build('aarch64', 'debug', 1_000, T0)])
    await s.watcher.ready
    s.set([build('aarch64', 'debug', 1_000, T1)])
    await settle()
    s.set([build('aarch64', 'debug', 1_000, T3)])
    await settle()
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
    await settle()
    expect(s.batches).toEqual([[build('aarch64', 'debug', 1_000, T1)]])
    s.watcher.stop()
  })

  test('a package deleted while pending is dropped', async () => {
    const s = setup()
    await s.watcher.ready
    s.set([build('aarch64', 'debug', 400, T1)])
    await poll()
    s.set([])
    await poll(4)
    expect(s.onSettled).not.toHaveBeenCalled()
    s.watcher.stop()
  })

  test('no build/ yet: the first build that appears is one batch', async () => {
    const s = setup([])
    await s.watcher.ready
    await poll(2)
    s.set([build('aarch64', 'debug', 1_000, T1)])
    await settle()
    expect(s.batches).toEqual([[build('aarch64', 'debug', 1_000, T1)]])
    s.watcher.stop()
  })

  test('a scan that fails is a poll that tells nothing', async () => {
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
    await settle()
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
    await settle()
    expect(s.onSettled).toHaveBeenCalledTimes(1)
    const scans = s.scan.mock.calls.length
    s.set([build('aarch64', 'debug', 1_000, T3)])
    await poll(5)
    expect(s.scan.mock.calls.length).toBe(scans)
    release()
    await settle()
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

// `react-native build-vega` packs aarch64, armv7, x86_64 in turn under build/private/, each
// copied to build/<arch>-debug/ when its pack ends (ARCHITECTURE §8). A redeploy mid-build makes
// OVD's vpt clash with the build's, so the batch waits for the whole build.
describe('watchBuilds: a build still packing', () => {
  const ARCHES: Arch[] = ['aarch64', 'armv7', 'x86_64']
  const before = ARCHES.map((a) => build(a, 'debug', 1_000, T0))
  const packedBefore = ARCHES.map((a) => packed(a, T0))

  test('an aarch64 copy, then armv7 packing: nothing until x86_64 is copied and settled', async () => {
    const s = setup(before, packedBefore)
    await s.watcher.ready
    const publicNow = [...before]
    const privateNow = [...packedBefore]
    // aarch64: packed at 0 s, copied at 6 s; armv7 packing starts 0.35 s later.
    privateNow[0] = packed('aarch64', at(0))
    s.setPrivate([...privateNow])
    await poll()
    await poll(5)
    publicNow[0] = build('aarch64', 'debug', 1_000, at(6))
    s.set([...publicNow])
    await poll()
    // The 0.3 s gap before the next pack: quiet so far, but not for 2 s.
    await poll()
    privateNow[1] = packed('armv7', at(7))
    s.setPrivate([...privateNow])
    // armv7 packs silently for about 6 s: the private package is newer than its copy.
    await poll(6)
    expect(s.onSettled).not.toHaveBeenCalled()
    publicNow[1] = build('armv7', 'debug', 1_000, at(13))
    privateNow[2] = packed('x86_64', at(13))
    s.set([...publicNow])
    s.setPrivate([...privateNow])
    await poll(6)
    expect(s.onSettled).not.toHaveBeenCalled()
    publicNow[2] = build('x86_64', 'debug', 1_000, at(19))
    s.set([...publicNow])
    await poll()
    expect(s.onSettled).not.toHaveBeenCalled()
    await poll(2)
    expect(s.batches).toEqual([[publicNow[2], publicNow[1], publicNow[0]]])
    await poll(5)
    expect(s.onSettled).toHaveBeenCalledTimes(1)
    s.watcher.stop()
  })

  test('a first build: the public folders appear one at a time, one batch at the end', async () => {
    const s = setup([], [])
    await s.watcher.ready
    const publicNow: PackageBuild[] = []
    const privateNow: PrivateBuild[] = []
    for (const [i, arch] of ARCHES.entries()) {
      privateNow.push(packed(arch, at(i * 6)))
      s.setPrivate([...privateNow])
      await poll(5)
      expect(s.onSettled).not.toHaveBeenCalled()
      publicNow.push(build(arch, 'debug', 1_000, at(i * 6 + 5)))
      s.set([...publicNow])
      await poll()
    }
    expect(s.onSettled).not.toHaveBeenCalled()
    await poll(2)
    expect(s.batches).toHaveLength(1)
    expect(s.batches[0]?.map((b) => b.folderArch)).toEqual(['x86_64', 'armv7', 'aarch64'])
    s.watcher.stop()
  })

  test('a private package newer than its public copy blocks the batch', async () => {
    const s = setup(before, packedBefore)
    await s.watcher.ready
    s.set([build('aarch64', 'debug', 1_000, at(5)), ...before.slice(1)])
    s.setPrivate([
      packed('aarch64', at(0)),
      packed('armv7', at(6)),
      packedBefore[2] as PrivateBuild
    ])
    await poll(10)
    expect(s.onSettled).not.toHaveBeenCalled()
    s.watcher.stop()
  })

  test('a private package of an unknown layout doesn’t block', async () => {
    const s = setup(before, [
      { path: `${FOLDER}/build/private/other.vpkg`, size: 1, modifiedAt: T3 }
    ])
    await s.watcher.ready
    s.set([build('aarch64', 'debug', 1_000, T1), ...before.slice(1)])
    await settle()
    expect(s.batches).toHaveLength(1)
    s.watcher.stop()
  })

  test('no private folder (another layout): the batch goes out once settled', async () => {
    const s = setup(before, [])
    await s.watcher.ready
    s.set([build('aarch64', 'debug', 1_000, T1), ...before.slice(1)])
    await settle()
    expect(s.batches).toEqual([[build('aarch64', 'debug', 1_000, T1)]])
    s.watcher.stop()
  })
})
