import { inflateRawSync } from 'node:zlib'
import { lstat, mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import {
  BUNDLE_FILES,
  createLogBundle,
  OvdError,
  type ActivityEntry,
  type Crash,
  type Device,
  type LogBundleDeps,
  type LogEntry,
  type LogSession,
  type OvdEvent
} from '../../src/index.js'

// A real-looking serial and address in the device's own fields: none may reach the bundle.
const SERIAL = 'G0W1A2B3C4D5E6F7'
const IP = '203.0.113.42'
const HOME_PATH = '/Users/someone/projects/player'
const LINUX_PATH = '/home/someone/work/player'

const device: Device = {
  id: SERIAL,
  vdaSerial: SERIAL,
  serial: SERIAL,
  name: 'Living room stick',
  kind: 'stick',
  connection: 'wifi',
  ip: IP,
  status: 'online',
  isTarget: true,
  saved: false,
  info: {
    os: 'Vega OS 1.1',
    build: 'build 25',
    architecture: 'armv7',
    profile: 'tv',
    product: 'Fire TV Stick 4K Select',
    simulated: false,
    developerMode: true,
    raw: { serial: SERIAL, ip: IP }
  }
}

const NOW = new Date('2026-11-14T10:15:30Z')

function entry(seq: number, over: Partial<LogEntry> = {}): LogEntry {
  return {
    seq,
    time: `2026-11-14T10:00:0${seq}.000Z`,
    deviceTime: null,
    level: 'I',
    priority: 'info',
    facility: 'local0',
    process: 'com.example.player',
    pid: 100,
    tid: 200,
    tag: 'com.amazon.keplerscript',
    message: `line ${seq}`,
    parsed: true,
    ...over
  }
}

function ovdLine(seq: number, event: OvdEvent, message: string): LogEntry {
  return {
    ...entry(seq),
    process: null,
    pid: null,
    tid: null,
    deviceTime: null,
    tag: 'OVD',
    message,
    ovd: event
  }
}

// A zip reader of our own: central directory, then each entry inflated and its CRC not checked
// (zipWriter's tests do that).
function unzip(zip: Buffer): Map<string, string> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const files = new Map<string, string>()
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(at + 10)
    const size = zip.readUInt32LE(at + 20)
    const nameLength = zip.readUInt16LE(at + 28)
    const extra = zip.readUInt16LE(at + 30)
    const comment = zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const data = zip.subarray(start, start + size)
    files.set(name, (method === 8 ? inflateRawSync(data) : data).toString('utf8'))
    at += 46 + nameLength + extra + comment
  }
  return files
}

let root: string
let activity: ActivityEntry[]
let deps: LogBundleDeps
let currentTarget: Mock<() => Promise<unknown>>
let apps: Mock<LogBundleDeps['apps']>
let crashList: Mock<LogBundleDeps['crashes']['list']>

const CRASH: Crash = {
  id: 3,
  package: 'com.example.player',
  kind: 'js',
  signal: 6,
  signalName: 'SIGABRT',
  pid: 3200,
  time: '2026-11-14T09:59:00.000Z',
  version: '1.0.2',
  build: '12',
  summary: `Error: failed to load ${HOME_PATH}/index.js`,
  new: false
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ovd-bundle-'))
  activity = []
  currentTarget = vi.fn(async () => ({ device, source: 'flag' }))
  apps = vi.fn(async () => [
    { packageId: 'com.example.player', version: '1.0.2' },
    { packageId: 'com.example.hellovega', version: '0.1.0' }
  ])
  crashList = vi.fn(async () => ({ device: device.name, crashes: [CRASH] }))
  deps = {
    logs: { start: vi.fn() },
    devices: { currentTarget } as unknown as LogBundleDeps['devices'],
    sdk: {
      get: async () => ({ vegaPath: '/sdk/vega', cli: 'manager', sdkVersion: '0.24.12112' }),
      rediscover: async () => ({ vegaPath: '/sdk/vega', cli: 'manager', sdkVersion: '0.24.12112' })
    },
    activity: {
      append: async (e) => {
        activity.push({ ...e, time: NOW.toISOString(), surface: 'cli' })
      }
    },
    crashes: { list: crashList },
    apps,
    env: {},
    homedir: root,
    cwd: root,
    now: () => NOW,
    ovdVersion: '0.4.0'
  }
})

const read = async (path: string) => unzip(await readFile(path))

describe('bundleEntries', () => {
  test('writes exactly the six files, with the manifest fields', async () => {
    const out = join(root, 'bundle.zip')
    const result = await createLogBundle(deps).bundleEntries({
      entries: [entry(0), entry(1, { level: 'E', message: 'boom' })],
      filter: { level: 'info', app: 'com.example.player' },
      preset: 'app-errors',
      out
    })
    expect(result).toEqual({
      device: { id: SERIAL, name: 'Living room stick' },
      path: out,
      bytes: (await lstat(out)).size,
      lines: 2,
      files: [...BUNDLE_FILES]
    })
    const files = await read(out)
    expect([...files.keys()]).toEqual([...BUNDLE_FILES])
    const manifest = JSON.parse(files.get('manifest.json') ?? '')
    expect(manifest).toEqual({
      format: 1,
      ovd: '0.4.0',
      sdk: '0.24.12112',
      createdAt: NOW.toISOString(),
      source: 'buffer',
      device: {
        name: 'Living room stick',
        kind: 'stick',
        model: 'Fire TV Stick 4K Select',
        os: 'Vega OS 1.1',
        build: 'build 25',
        architecture: 'armv7'
      },
      lines: 2,
      timeRange: { from: '2026-11-14T10:00:00.000Z', to: '2026-11-14T10:00:01.000Z' },
      filter: { app: 'com.example.player', level: 'info' },
      preset: 'app-errors',
      apps: 'ok',
      crashes: 'ok'
    })
    expect(files.get('README.txt')).toContain('may hold tokens, user data or addresses')
    expect(files.get('logs.txt')).toContain('line 0')
    expect(files.get('logs.txt')).toContain('boom')
    const jsonl = (files.get('logs.jsonl') ?? '').trim().split('\n')
    expect(jsonl.map((line) => JSON.parse(line).message)).toEqual(['line 0', 'boom'])
    expect(JSON.parse(files.get('apps.json') ?? '')).toEqual({
      apps: [
        { id: 'com.example.player', version: '1.0.2' },
        { id: 'com.example.hellovega', version: '0.1.0' }
      ]
    })
  })

  test('crashes.json is metadata only: no summary, no report text', async () => {
    const out = join(root, 'b.zip')
    await createLogBundle(deps).bundleEntries({ entries: [], out })
    const crashes = JSON.parse((await read(out)).get('crashes.json') ?? '')
    expect(crashes).toEqual({
      crashes: [
        {
          id: 3,
          package: 'com.example.player',
          kind: 'js',
          signal: 6,
          signalName: 'SIGABRT',
          pid: 3200,
          time: '2026-11-14T09:59:00.000Z',
          version: '1.0.2',
          build: '12'
        }
      ]
    })
  })

  test('no serial, address or host path in any file, whatever the search text and OVD events hold', async () => {
    const out = join(root, 'b.zip')
    await createLogBundle(deps).bundleEntries({
      entries: [
        entry(0),
        ovdLine(
          1,
          {
            kind: 'build',
            folder: `${HOME_PATH}/build/armv7-release/`,
            file: `${LINUX_PATH}/player.vpkg`
          },
          `Build folder changed: ${HOME_PATH}/build/armv7-release/${LINUX_PATH}/player.vpkg`
        ),
        ovdLine(
          2,
          {
            kind: 'install',
            action: 'app.install',
            surface: 'cli',
            result: 'ok',
            package: 'com.example.player',
            app: `${HOME_PATH}/build/player.vpkg`
          },
          `Installed com.example.player from the CLI`
        ),
        ovdLine(
          3,
          {
            kind: 'install',
            action: 'app.install',
            surface: 'cli',
            result: 'ok',
            package: `${HOME_PATH}/build/player.vpkg`
          },
          'Installed'
        ),
        ovdLine(
          4,
          {
            kind: 'launch',
            action: 'app.launch',
            surface: 'cli',
            app: LINUX_PATH,
            result: 'verified'
          },
          `Launch of ${LINUX_PATH} verified`
        )
      ],
      filter: { search: `${HOME_PATH} secret-token`, level: 'info' },
      out
    })
    const files = await read(out)
    const joined = [...files.values()].join('\n')
    for (const bad of [HOME_PATH, LINUX_PATH, '/Users/', '/home/', 'secret-token', SERIAL, IP]) {
      expect(joined).not.toContain(bad)
    }
    const manifest = JSON.parse(files.get('manifest.json') ?? '')
    expect(manifest.filter).toEqual({ level: 'info', search: 'set' })
    // Rebuilt: a build is "new build", an install keeps the package ID only.
    const text = files.get('logs.txt') ?? ''
    expect(text).toContain('OVD New build')
    expect(text).toContain('Installed com.example.player from the CLI')
    expect(text).toContain('Launch of the app verified')
    const jsonl = (files.get('logs.jsonl') ?? '')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(jsonl[1]).toEqual({
      time: '2026-11-14T10:00:01.000Z',
      ovd: { kind: 'build' },
      message: 'New build'
    })
    expect(jsonl[2].ovd).toEqual({
      kind: 'install',
      action: 'app.install',
      surface: 'cli',
      result: 'ok',
      package: 'com.example.player'
    })
  })

  test('events are rebuilt from an allow-list: paths in app, unknown fields and bad patterns are dropped', async () => {
    const out = join(root, 'b.zip')
    const loose = (event: Record<string, unknown>) => event as unknown as OvdEvent
    await createLogBundle(deps).bundleEntries({
      entries: [
        ovdLine(
          0,
          loose({
            kind: 'launch',
            action: 'app.launch',
            surface: 'cli',
            result: 'crashed',
            app: HOME_PATH,
            signal: `${LINUX_PATH}/x`,
            extra: HOME_PATH
          }),
          'x'
        ),
        ovdLine(
          1,
          loose({ kind: 'crash', app: LINUX_PATH, pid: 4, signal: 'SIGSEGV', secret: HOME_PATH }),
          'x'
        ),
        ovdLine(
          2,
          loose({ kind: 'rate-limited', process: HOME_PATH, hidden: 3, second: LINUX_PATH }),
          'x'
        ),
        ovdLine(3, loose({ kind: 'disconnected', note: HOME_PATH }), 'x')
      ],
      out
    })
    const files = await read(out)
    const joined = [...files.values()].join('\n')
    for (const bad of [HOME_PATH, LINUX_PATH, 'secret', 'extra', 'note']) {
      expect(joined).not.toContain(bad)
    }
    const jsonl = (files.get('logs.jsonl') ?? '')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(jsonl[0].ovd).toEqual({
      kind: 'launch',
      action: 'app.launch',
      surface: 'cli',
      result: 'crashed'
    })
    expect(jsonl[1].ovd).toEqual({ kind: 'crash', pid: 4, signal: 'SIGSEGV' })
    expect(jsonl[3].ovd).toEqual({ kind: 'disconnected' })
  })

  test('the manifest filter masks tag, identity and rule identities', async () => {
    const out = join(root, 'b.zip')
    await createLogBundle(deps).bundleEntries({
      entries: [],
      filter: {
        tag: [HOME_PATH, 'two'],
        identity: [LINUX_PATH],
        level: 'info',
        pid: [5],
        processRules: [
          { identity: `${HOME_PATH}/a`, level: 'warn' },
          { identity: `${LINUX_PATH}/b`, rate: 5 },
          { identity: 'secret-proc', mute: true }
        ]
      },
      out
    })
    const files = await read(out)
    const joined = [...files.values()].join('\n')
    for (const bad of [HOME_PATH, LINUX_PATH, 'secret-proc', '/Users/', '/home/']) {
      expect(joined).not.toContain(bad)
    }
    const { filter } = JSON.parse(files.get('manifest.json') ?? '')
    expect(filter).toMatchObject({
      level: 'info',
      pid: '5',
      tag: '2 values',
      identity: '1 value',
      mute: '1 value',
      'process-rate': '#2=5'
    })
    expect(filter['process-level']).toMatch(/^#1=/)
  })

  test('crashes.json drops a crash whose package isn’t an app ID', async () => {
    crashList.mockResolvedValue({
      device: device.name,
      crashes: [CRASH, { ...CRASH, id: 4, package: `${HOME_PATH}/x` }]
    })
    const out = join(root, 'b.zip')
    await createLogBundle(deps).bundleEntries({ entries: [], out })
    const files = await read(out)
    const crashes = JSON.parse(files.get('crashes.json') ?? '').crashes
    expect(crashes.map((c: { id: number }) => c.id)).toEqual([3])
    expect(files.get('crashes.json')).not.toContain(HOME_PATH)
  })

  test('the default multi-stick name is replaced when it holds part of the serial', async () => {
    currentTarget.mockResolvedValue({
      device: { ...device, name: `Fire TV stick ${SERIAL.slice(-4)}` }
    })
    const result = await createLogBundle(deps).bundleEntries({ entries: [], out: root })
    expect(result.device.name).toBe('Fire TV stick')
    expect(result.path).not.toContain(SERIAL.slice(-4).toLowerCase())
    currentTarget.mockResolvedValue({
      device: { ...device, kind: 'vvd', name: `Vega ${SERIAL.slice(2, 8)}` }
    })
    const vvd = await createLogBundle(deps).bundleEntries({ entries: [], out: root })
    expect(vvd.device.name).toBe('Vega Virtual Device')
  })

  test('crash and rate-limited events keep their validated fields', async () => {
    const out = join(root, 'b.zip')
    await createLogBundle(deps).bundleEntries({
      entries: [
        ovdLine(0, { kind: 'crash', app: 'com.example.player', pid: 7, signal: 'SIGABRT' }, 'x'),
        ovdLine(
          1,
          {
            kind: 'rate-limited',
            process: 'com.example.player',
            hidden: 5,
            second: '2026-11-14T10:00:00Z'
          },
          'x'
        )
      ],
      out
    })
    const text = (await read(out)).get('logs.txt') ?? ''
    expect(text).toContain('Crash report: com.example.player (pid 7, SIGABRT)')
    expect(text).toContain('com.example.player: 5 lines hidden by rate limit')
  })

  test('the device’s own log text is copied as received', async () => {
    const out = join(root, 'b.zip')
    await createLogBundle(deps).bundleEntries({
      entries: [entry(0, { message: `reading ${HOME_PATH}/x token=abc` })],
      out
    })
    const files = await read(out)
    expect(files.get('logs.txt')).toContain(`reading ${HOME_PATH}/x token=abc`)
    expect(files.get('logs.jsonl')).toContain(`reading ${HOME_PATH}/x token=abc`)
  })

  test('a device name that holds the serial or address is replaced, in the manifest and the file name', async () => {
    currentTarget.mockResolvedValue({ device: { ...device, name: `Stick ${SERIAL}` } })
    const dir = join(root, 'out')
    await mkdir(dir)
    const result = await createLogBundle(deps).bundleEntries({ entries: [], out: dir })
    expect(result.device.name).toBe('Fire TV stick')
    expect(result.path).toBe(join(dir, 'ovd-logs-fire-tv-stick-20261114-101530.zip'))
    expect(JSON.parse((await read(result.path)).get('manifest.json') ?? '').device.name).toBe(
      'Fire TV stick'
    )
  })

  test('unavailable apps or crashes: still written, the manifest says so with the code', async () => {
    apps.mockRejectedValue(new OvdError('COMMAND_FAILED', 'vpm failed', 'x'))
    crashList.mockRejectedValue(new OvdError('CRASH_ACCESS_DENIED', 'no', 'x'))
    const out = join(root, 'b.zip')
    await createLogBundle(deps).bundleEntries({ entries: [entry(0)], out })
    const files = await read(out)
    expect([...files.keys()]).toEqual([...BUNDLE_FILES])
    const manifest = JSON.parse(files.get('manifest.json') ?? '')
    expect(manifest).toMatchObject({
      apps: 'unavailable',
      appsError: 'COMMAND_FAILED',
      crashes: 'unavailable',
      crashesError: 'CRASH_ACCESS_DENIED'
    })
    expect(JSON.parse(files.get('apps.json') ?? '')).toEqual({
      unavailable: true,
      error: 'COMMAND_FAILED'
    })
    expect(JSON.parse(files.get('crashes.json') ?? '')).toEqual({
      unavailable: true,
      error: 'CRASH_ACCESS_DENIED'
    })
  })

  test('a device without info still gets a manifest', async () => {
    const bare: Device = { ...device }
    delete bare.info
    currentTarget.mockResolvedValue({ device: bare })
    const out = join(root, 'b.zip')
    await createLogBundle(deps).bundleEntries({ entries: [], out })
    const manifest = JSON.parse((await read(out)).get('manifest.json') ?? '')
    expect(manifest.device).toEqual({ name: 'Living room stick', kind: 'stick' })
    expect(manifest.timeRange).toBeNull()
  })

  test('the default folder is created 0700, the file is 0600, with the default name', async () => {
    const result = await createLogBundle(deps).bundleEntries({ entries: [entry(0)] })
    const dir = join(root, 'ovd', 'bundles')
    expect(result.path).toBe(join(dir, 'ovd-logs-living-room-stick-20261114-101530.zip'))
    expect((await lstat(dir)).mode & 0o777).toBe(0o700)
    expect((await lstat(result.path)).mode & 0o777).toBe(0o600)
    expect(await readdir(dir)).toEqual(['ovd-logs-living-room-stick-20261114-101530.zip'])
    // A second one in the same second takes the next name.
    const second = await createLogBundle(deps).bundleEntries({ entries: [] })
    expect(second.path).toBe(join(dir, 'ovd-logs-living-room-stick-20261114-101530-2.zip'))
  })

  test('OVD_BUNDLES moves the default folder', async () => {
    const result = await createLogBundle({
      ...deps,
      env: { OVD_BUNDLES: join(root, 'mine') }
    }).bundleEntries({ entries: [] })
    expect(result.path.startsWith(join(root, 'mine'))).toBe(true)
  })

  test('an existing file needs force, and force replaces it', async () => {
    const out = join(root, 'b.zip')
    await writeFile(out, 'old')
    await expect(createLogBundle(deps).bundleEntries({ entries: [], out })).rejects.toMatchObject({
      code: 'EXPORT_FILE_EXISTS'
    })
    expect(await readFile(out, 'utf8')).toBe('old')
    await createLogBundle(deps).bundleEntries({ entries: [], out, force: true })
    expect([...(await read(out)).keys()]).toEqual([...BUNDLE_FILES])
  })

  test('a symlinked destination is refused, force included, and its target is untouched', async () => {
    const target = join(root, 'victim.zip')
    await writeFile(target, 'victim')
    const link = join(root, 'link.zip')
    await symlink(target, link)
    for (const force of [false, true]) {
      await expect(
        createLogBundle(deps).bundleEntries({ entries: [], out: link, force })
      ).rejects.toMatchObject({ code: 'INVALID_PATH' })
    }
    expect(await readFile(target, 'utf8')).toBe('victim')
  })

  test('a symlinked default folder is refused', async () => {
    const real = join(root, 'real')
    await mkdir(real)
    await mkdir(join(root, 'ovd'))
    await symlink(real, join(root, 'ovd', 'bundles'))
    await expect(createLogBundle(deps).bundleEntries({ entries: [] })).rejects.toMatchObject({
      code: 'INVALID_PATH'
    })
    expect(await readdir(real)).toEqual([])
  })

  test('--out must be a .zip, and is checked before the target is read', async () => {
    await expect(
      createLogBundle(deps).bundleEntries({ entries: [], out: join(root, 'b.tar') })
    ).rejects.toMatchObject({ code: 'INVALID_PATH' })
    expect(currentTarget).not.toHaveBeenCalled()
  })

  test.each([
    ['a bad level', { level: 'loud' }],
    ['a regex bomb', { search: '(a+)+$', regex: true }]
  ])('%s is INVALID_LOG_FILTER before any device is read', async (_l, filter) => {
    await expect(
      createLogBundle(deps).bundleEntries({ entries: [], filter, out: join(root, 'b.zip') })
    ).rejects.toMatchObject({ code: 'INVALID_LOG_FILTER' })
    expect(currentTarget).not.toHaveBeenCalled()
    expect(apps).not.toHaveBeenCalled()
  })

  test('a preset that isn’t a name never reaches the manifest', async () => {
    await expect(
      createLogBundle(deps).bundleEntries({
        entries: [],
        preset: HOME_PATH,
        out: join(root, 'b.zip')
      })
    ).rejects.toMatchObject({ code: 'INVALID_LOG_FILTER_NAME' })
  })

  test('an offline target is TARGET_OFFLINE and writes nothing', async () => {
    currentTarget.mockResolvedValue({ device: { ...device, status: 'offline' }, source: 'flag' })
    await expect(
      createLogBundle(deps).bundleEntries({ entries: [], out: join(root, 'b.zip') })
    ).rejects.toMatchObject({ code: 'TARGET_OFFLINE' })
    expect(await readdir(root)).toEqual([])
  })

  test('one activity entry: the device, line count, bytes and file name only', async () => {
    const out = join(root, 'b.zip')
    const result = await createLogBundle(deps).bundleEntries({
      entries: [entry(0), entry(1)],
      filter: { search: 'secret-token', regex: false },
      out
    })
    expect(activity).toHaveLength(1)
    expect(activity[0]).toMatchObject({
      action: 'logs.bundle',
      target: SERIAL,
      args: { lines: 2, bytes: result.bytes, file: 'b.zip' },
      result: 'ok'
    })
    const logged = JSON.stringify(activity)
    expect(logged).not.toContain('secret-token')
    expect(logged).not.toContain(root)
  })

  test('a failed save writes one error entry', async () => {
    const out = join(root, 'b.zip')
    const fs = {
      link: () => Promise.reject(Object.assign(new Error('x'), { code: 'EACCES' })),
      copyFile: () => Promise.reject(Object.assign(new Error('x'), { code: 'EACCES' })),
      rename: () => Promise.reject(Object.assign(new Error('x'), { code: 'EACCES' }))
    }
    await expect(
      createLogBundle({ ...deps, fs }).bundleEntries({ entries: [], out })
    ).rejects.toMatchObject({ code: 'LOG_BUNDLE_FAILED' })
    expect(activity).toMatchObject([
      { action: 'logs.bundle', result: 'error', errorCode: 'LOG_BUNDLE_FAILED', args: {} }
    ])
    // No temp file is left behind.
    expect(await readdir(root)).toEqual([])
  })
})

describe('bundle (a bounded capture)', () => {
  function fakeSession(entries: LogEntry[], endsWith?: OvdError) {
    const stop = vi.fn(async () => undefined)
    const session = {
      done: endsWith
        ? Promise.resolve({ reason: 'ended' as const, error: endsWith })
        : new Promise<never>(() => undefined),
      entries: () => entries,
      stop
    } as unknown as LogSession
    const start = vi.fn(async () => session)
    return { start, stop }
  }

  test('runs a session for the duration (boot tagging is the default), then bundles its entries', async () => {
    const { start, stop } = fakeSession([entry(0), entry(1)])
    const sleep = vi.fn(async () => undefined)
    const out = join(root, 'b.zip')
    const result = await createLogBundle({ ...deps, logs: { start }, sleep }).bundle({
      filter: { level: 'info' },
      durationS: 12,
      out
    })
    expect(start).toHaveBeenCalledWith({
      device: SERIAL,
      filter: { level: 'info' }
    })
    expect(sleep).toHaveBeenCalledWith(12_000, undefined)
    expect(stop).toHaveBeenCalledOnce()
    expect(result.lines).toBe(2)
    expect(JSON.parse((await read(out)).get('manifest.json') ?? '').source).toBe('capture')
  })

  test('the duration defaults to 5 seconds', async () => {
    const { start } = fakeSession([])
    const sleep = vi.fn(async () => undefined)
    await createLogBundle({ ...deps, logs: { start }, sleep }).bundle({ out: join(root, 'b.zip') })
    expect(sleep).toHaveBeenCalledWith(5_000, undefined)
  })

  test.each([0, 301, 1.5, Number.NaN, -1])(
    'a duration of %s is INVALID_TIMEOUT before any SDK call',
    async (durationS) => {
      const { start } = fakeSession([])
      await expect(
        createLogBundle({ ...deps, logs: { start } }).bundle({
          durationS,
          out: join(root, 'b.zip')
        })
      ).rejects.toMatchObject({ code: 'INVALID_TIMEOUT' })
      expect(start).not.toHaveBeenCalled()
      expect(currentTarget).not.toHaveBeenCalled()
    }
  )

  test('a stream that ends with an error fails the bundle, writes an error entry and no file', async () => {
    const error = new OvdError('LOG_STREAM_ENDED', 'The log stream ended', 'x')
    const { start, stop } = fakeSession([], error)
    const sleep = () => new Promise<void>(() => undefined)
    await expect(
      createLogBundle({ ...deps, logs: { start }, sleep }).bundle({ out: join(root, 'b.zip') })
    ).rejects.toMatchObject({ code: 'LOG_STREAM_ENDED' })
    expect(stop).toHaveBeenCalledOnce()
    expect(activity).toMatchObject([
      { action: 'logs.bundle', result: 'error', errorCode: 'LOG_STREAM_ENDED' }
    ])
    expect(await readdir(root)).toEqual([])
  })

  test('an abort stops the session, writes nothing and no entry', async () => {
    const { start, stop } = fakeSession([entry(0)])
    const controller = new AbortController()
    const sleep = async () => {
      controller.abort()
    }
    await expect(
      createLogBundle({ ...deps, logs: { start }, sleep }).bundle({
        out: join(root, 'b.zip'),
        signal: controller.signal
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(stop).toHaveBeenCalledOnce()
    expect(activity).toEqual([])
    expect(await readdir(root)).toEqual([])
  })
})
