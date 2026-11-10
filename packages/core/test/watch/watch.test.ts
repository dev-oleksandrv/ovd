import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createWatch,
  OvdError,
  type ActivityEntry,
  type BuildChange,
  type Device,
  type PackageBuild,
  type PrivateBuild,
  type ProjectMode,
  type ResolvedTarget
} from '../../src/index.js'

const POLL = 1_000
const T0 = '2026-11-10T09:00:00.000Z'
const T1 = '2026-11-10T09:05:00.000Z'
const T2 = '2026-11-10T09:05:01.000Z'

const info = (architecture: string) => ({
  os: 'Vega OS',
  build: '0.24',
  architecture,
  profile: 'tv',
  product: 'sample',
  simulated: architecture !== 'armv7',
  developerMode: true,
  raw: {}
})
const vvd: Device = {
  id: 'VirtualDevice',
  vdaSerial: 'emulator-5554',
  serial: 'VirtualDevice',
  name: 'Vega Virtual Device',
  kind: 'vvd',
  connection: 'local',
  status: 'online',
  isTarget: true,
  saved: false,
  info: info('aarch64')
}
const stick: Device = {
  id: 'G070000000000001',
  vdaSerial: 'G070000000000001',
  serial: 'G070000000000001',
  name: 'Fire TV Stick 4K Select',
  kind: 'stick',
  connection: 'usb',
  status: 'online',
  isTarget: true,
  saved: false,
  info: info('armv7')
}

let home: string
let project: string

function build(arch: 'aarch64' | 'armv7', type: 'debug' | 'release', at: string): PackageBuild {
  const file = `player_${arch}.vpkg`
  return {
    path: `${project}/build/${arch}-${type}/${file}`,
    displayPath: `~/dev/player/build/${arch}-${type}/${file}`,
    file,
    folder: `build/${arch}-${type}/`,
    size: 1_000,
    modifiedAt: at,
    folderArch: arch,
    folderBuildType: type
  }
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ovd-watch-'))
  project = join(home, 'dev', 'player')
  await mkdir(project, { recursive: true })
  await writeFile(join(project, 'manifest.toml'), '')
  await writeFile(join(project, 'package.json'), '{}')
  await writeFile(join(home, 'player_aarch64.vpkg'), 'fake')
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(home, { recursive: true, force: true })
})

// A core with the player project open, `target` as the target, and a build folder whose builds
// a test sets between polls.
function setup(
  opts: {
    target?: ResolvedTarget | null | OvdError
    mode?: ProjectMode | null
    builds?: PackageBuild[]
    privates?: PrivateBuild[]
  } = {}
) {
  let builds = opts.builds ?? [build('aarch64', 'debug', T0), build('armv7', 'release', T0)]
  let mode: ProjectMode | null =
    opts.mode === undefined
      ? { kind: 'folder', path: project, displayPath: '~/dev/player', name: 'player' }
      : opts.mode
  const entries: Omit<ActivityEntry, 'time' | 'surface'>[] = []
  let privates: PrivateBuild[] = opts.privates ?? []
  const target =
    opts.target === undefined ? { device: vvd, source: 'remembered' as const } : opts.target
  const currentTarget = vi.fn(async () => {
    if (target instanceof OvdError) throw target
    return target
  })
  const watch = createWatch({
    devices: { currentTarget },
    packages: { builds: async () => builds },
    project: { current: async () => mode },
    activity: { append: async (entry) => void entries.push(entry) },
    homedir: home,
    cwd: home,
    // Fake timers don't wait for disk reads: the private packages are set by the test.
    privateBuilds: async () => privates
  })
  const changes: BuildChange[] = []
  const onBuild = vi.fn((change: BuildChange) => void changes.push(change))
  return {
    watch,
    entries,
    changes,
    onBuild,
    currentTarget,
    setBuilds: (next: PackageBuild[]) => (builds = next),
    setMode: (next: ProjectMode | null) => (mode = next),
    setPrivates: (next: PrivateBuild[]) => (privates = next)
  }
}

const poll = (n = 1) => vi.advanceTimersByTimeAsync(POLL * n)

describe('watch.folder', () => {
  test('a project folder, by path or as the open project', async () => {
    const s = setup()
    expect(await s.watch.folder('dev/player')).toEqual({
      path: project,
      displayPath: '~/dev/player'
    })
    expect(await s.watch.folder()).toEqual({ path: project, displayPath: '~/dev/player' })
  })

  test.each<[string, string | undefined, ProjectMode | null]>([
    ['a .vpkg', 'player_aarch64.vpkg', null],
    ['a package ID', 'com.example.player', null],
    ['nothing open', undefined, null],
    [
      'a .vpkg open',
      undefined,
      {
        kind: 'vpkg',
        path: '/home/dev/Downloads/player_aarch64.vpkg',
        displayPath: '~/Downloads/player_aarch64.vpkg',
        file: 'player_aarch64.vpkg'
      }
    ],
    [
      'an open project that is gone',
      undefined,
      { kind: 'folder', path: '/gone', displayPath: '/gone', name: 'gone', missing: true }
    ]
  ])('%s: NOT_A_PROJECT', async (_name, ref, mode) => {
    const s = setup({ mode })
    await expect(s.watch.folder(ref)).rejects.toMatchObject({
      code: 'NOT_A_PROJECT',
      message: 'ovd run --watch needs a project folder',
      hint: 'Pass a project folder or open one with ovd open <folder>'
    })
  })

  test('a folder that isn’t a Vega project: NOT_A_PROJECT naming the missing file', async () => {
    await mkdir(join(home, 'notes'))
    const s = setup()
    await expect(s.watch.folder('notes')).rejects.toMatchObject({
      code: 'NOT_A_PROJECT',
      message: 'Not a Vega project: no manifest.toml in ~/notes'
    })
  })
})

describe('watch.start', () => {
  test('the Virtual Device: picks the aarch64 debug build, logs build.changed, then onBuild', async () => {
    const s = setup()
    const handle = await s.watch.start(project, { onBuild: s.onBuild, pollMs: POLL })
    expect(handle.path).toBe(project)
    // `react-native build-vega` writes every architecture of the type (ARCHITECTURE §8).
    s.setBuilds([
      build('aarch64', 'debug', T1),
      build('armv7', 'release', T0),
      build('armv7', 'debug', T2)
    ])
    await poll(3)

    expect(s.changes).toEqual([
      {
        folder: { path: project, displayPath: '~/dev/player' },
        changed: [build('armv7', 'debug', T2), build('aarch64', 'debug', T1)],
        build: build('aarch64', 'debug', T1),
        target: { id: 'VirtualDevice', name: 'Vega Virtual Device', architecture: 'aarch64' }
      }
    ])
    expect(s.entries).toEqual([
      {
        action: 'build.changed',
        target: 'VirtualDevice',
        args: { folder: 'build/aarch64-debug/', file: 'player_aarch64.vpkg', redeploy: true },
        result: 'ok'
      }
    ])
    handle.stop()
    expect(await handle.done).toEqual({ reason: 'stopped' })
  })

  test('a stick prefers the release build among the matching ones', async () => {
    const s = setup({
      target: { device: stick, source: 'remembered' },
      builds: [build('armv7', 'debug', T0), build('armv7', 'release', T0)]
    })
    const handle = await s.watch.start(project, { onBuild: s.onBuild, pollMs: POLL })
    s.setBuilds([build('armv7', 'debug', T2), build('armv7', 'release', T1)])
    await poll(3)
    expect(s.changes[0]?.build).toEqual(build('armv7', 'release', T1))
    handle.stop()
  })

  test('no changed build for the target: no build, redeploy false, the newest named', async () => {
    const s = setup()
    const handle = await s.watch.start(project, { onBuild: s.onBuild, pollMs: POLL })
    s.setBuilds([build('aarch64', 'debug', T0), build('armv7', 'release', T1)])
    await poll(3)
    expect(s.changes).toHaveLength(1)
    expect(s.changes[0]?.build).toBeUndefined()
    expect(s.changes[0]?.target?.id).toBe('VirtualDevice')
    expect(s.entries).toEqual([
      {
        action: 'build.changed',
        target: 'VirtualDevice',
        args: { folder: 'build/armv7-release/', file: 'player_armv7.vpkg', redeploy: false },
        result: 'ok'
      }
    ])
    handle.stop()
  })

  test('an offline target: the error is passed on, the entry still names the device', async () => {
    const s = setup({ target: { device: { ...vvd, status: 'stopped' }, source: 'remembered' } })
    const handle = await s.watch.start(project, { onBuild: s.onBuild, pollMs: POLL })
    s.setBuilds([build('aarch64', 'debug', T1), build('armv7', 'release', T0)])
    await poll(3)
    expect(s.changes[0]?.build).toBeUndefined()
    expect(s.changes[0]?.target).toBeUndefined()
    expect(s.changes[0]?.error).toMatchObject({
      code: 'TARGET_OFFLINE',
      message: 'Vega Virtual Device is stopped'
    })
    expect(s.entries).toEqual([
      {
        action: 'build.changed',
        target: 'VirtualDevice',
        args: { folder: 'build/aarch64-debug/', file: 'player_aarch64.vpkg', redeploy: false },
        result: 'error',
        errorCode: 'TARGET_OFFLINE'
      }
    ])
    handle.stop()
  })

  test.each<[string, null | OvdError, string]>([
    ['no target', null, 'NO_TARGET'],
    [
      'an unknown --device',
      new OvdError('DEVICE_NOT_FOUND', 'No device 192.0.2.7:5555', 'hint'),
      'DEVICE_NOT_FOUND'
    ]
  ])('%s: the error is passed on with target null, never thrown', async (_name, target, code) => {
    const s = setup({ target })
    const handle = await s.watch.start(project, { onBuild: s.onBuild, pollMs: POLL })
    s.setBuilds([build('aarch64', 'debug', T1), build('armv7', 'release', T0)])
    await poll(3)
    expect(s.changes[0]?.error?.code).toBe(code)
    expect(s.entries[0]).toMatchObject({ target: null, result: 'error', errorCode: code })
    handle.stop()
  })

  test('`device` is read fresh for every batch', async () => {
    const s = setup()
    const handle = await s.watch.start(project, {
      device: 'VirtualDevice',
      onBuild: s.onBuild,
      pollMs: POLL
    })
    s.setBuilds([build('aarch64', 'debug', T1), build('armv7', 'release', T0)])
    await poll(3)
    s.setBuilds([build('aarch64', 'debug', T2), build('armv7', 'release', T0)])
    await poll(3)
    expect(s.currentTarget.mock.calls).toEqual([['VirtualDevice'], ['VirtualDevice']])
    expect(s.changes).toHaveLength(2)
    handle.stop()
  })

  test('the open project switched: the watch ends itself, writes nothing, calls no onBuild', async () => {
    const s = setup()
    const handle = await s.watch.start(undefined, { onBuild: s.onBuild, pollMs: POLL })
    s.setMode({
      kind: 'folder',
      path: join(home, 'dev', 'hellovega'),
      displayPath: '~/dev/hellovega',
      name: 'hellovega'
    })
    s.setBuilds([build('aarch64', 'debug', T1), build('armv7', 'release', T0)])
    await poll(3)
    expect(await handle.done).toEqual({ reason: 'project-changed' })
    expect(s.onBuild).not.toHaveBeenCalled()
    expect(s.entries).toEqual([])
  })

  test('a folder given by path keeps watching when another project is opened', async () => {
    const s = setup()
    const handle = await s.watch.start(project, { onBuild: s.onBuild, pollMs: POLL })
    s.setMode(null)
    s.setBuilds([build('aarch64', 'debug', T1), build('armv7', 'release', T0)])
    await poll(3)
    expect(s.onBuild).toHaveBeenCalledTimes(1)
    handle.stop()
  })

  test('no redeploy while the build still packs another architecture', async () => {
    const packed = (arch: 'aarch64' | 'armv7', type: 'Debug' | 'Release', modifiedAt: string) => ({
      path: `${project}/build/private/kepler/@amazon-devices/player/undefined/vega/${arch}/${type}/@amazon-devices/player_${arch}.vpkg`,
      size: 1_000,
      modifiedAt,
      arch,
      buildType: type.toLowerCase() as 'debug' | 'release'
    })
    const s = setup({
      builds: [build('aarch64', 'debug', T0), build('armv7', 'debug', T0)],
      privates: [packed('aarch64', 'Debug', T0), packed('armv7', 'Debug', T0)]
    })
    const handle = await s.watch.start(project, { onBuild: s.onBuild, pollMs: POLL })
    // aarch64 copied; armv7 packing (its private package newer than its copy).
    s.setBuilds([build('aarch64', 'debug', T1), build('armv7', 'debug', T0)])
    s.setPrivates([packed('aarch64', 'Debug', T0), packed('armv7', 'Debug', T1)])
    await poll(6)
    expect(s.onBuild).not.toHaveBeenCalled()
    expect(s.entries).toEqual([])
    s.setBuilds([build('aarch64', 'debug', T1), build('armv7', 'debug', T2)])
    await poll(3)
    expect(s.changes.map((c) => c.build)).toEqual([build('aarch64', 'debug', T1)])
    expect(s.changes[0]?.changed).toHaveLength(2)
    handle.stop()
  })

  test('no build/ at the start, then a build appears: one batch', async () => {
    const s = setup({ builds: [] })
    const handle = await s.watch.start(project, { onBuild: s.onBuild, pollMs: POLL })
    await poll(3)
    expect(s.onBuild).not.toHaveBeenCalled()
    s.setBuilds([build('aarch64', 'debug', T1)])
    await poll(3)
    expect(s.changes.map((c) => c.build)).toEqual([build('aarch64', 'debug', T1)])
    handle.stop()
  })

  test('an abort ends the watch', async () => {
    const s = setup()
    const controller = new AbortController()
    const handle = await s.watch.start(project, {
      onBuild: s.onBuild,
      pollMs: POLL,
      signal: controller.signal
    })
    controller.abort()
    expect(await handle.done).toEqual({ reason: 'stopped' })
    s.setBuilds([build('aarch64', 'debug', T1)])
    await poll(3)
    expect(s.onBuild).not.toHaveBeenCalled()
  })

  test('NOT_A_PROJECT before anything is watched', async () => {
    const s = setup()
    await expect(
      s.watch.start('player_aarch64.vpkg', { onBuild: s.onBuild, pollMs: POLL })
    ).rejects.toMatchObject({ code: 'NOT_A_PROJECT' })
  })
})
