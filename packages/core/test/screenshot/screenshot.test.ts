import { copyFile, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  createActivityLog,
  createScreenshot,
  createSdkLocator,
  OvdError,
  type ActivityEntry,
  type CommandSpec,
  type Device,
  type Devices,
  type Runner,
  type RunResult,
  type ScreenshotDeps
} from '../../src/index.js'
import { unframe, decodeImage } from '../../src/vvd/grpcWire.js'
import { fixture } from '../support/fixtures.js'

const SYNTHETIC = new URL(
  '../../../../fixtures/0.24/vda-pull/synthetic-screenshot.png',
  import.meta.url
)
// The PNG the recorded getScreenshot answer carries.
const GRPC_PNG = (() => {
  const recorded = JSON.parse(fixture('0.24/emulator-grpc/get-screenshot.json')) as {
    body: string
  }
  const [message] = unframe(new Uint8Array(Buffer.from(recorded.body, 'hex')))
  return decodeImage(message ?? new Uint8Array())
})()

const HEX = '0123abcd'
const REMOTE = `/tmp/ovd-screenshot-${HEX}.png`
const AT = new Date(2026, 10, 12, 2, 11, 0)
const SHOOT = `vega exec vda -s G070000000000001 shell gwsi-tool-screenshooter ${REMOTE}`
const RM = `vega exec vda -s G070000000000001 shell rm -f ${REMOTE}`
const PULL = `vega exec vda -s G070000000000001 pull ${REMOTE} `

const stick: Device = {
  id: 'G070000000000001',
  vdaSerial: 'G070000000000001',
  serial: 'G070000000000001',
  name: 'Living room stick',
  kind: 'stick',
  connection: 'usb',
  status: 'online',
  isTarget: true,
  saved: false
}

const vvd: Device = {
  id: 'VirtualDevice',
  vdaSerial: 'emulator-5554',
  serial: 'VirtualDevice',
  name: 'Vega Virtual Device',
  kind: 'vvd',
  connection: 'local',
  status: 'online',
  isTarget: false,
  saved: false
}

let root: string
let home: string
let captures: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ovd-screenshot-'))
  home = join(root, 'ovd')
  captures = join(root, 'captures')
})

type Answer =
  | Partial<Omit<RunResult, 'command'>>
  | OvdError
  | ((spec: CommandSpec) => Promise<Partial<RunResult>>)

// Answers by the start of the command users see; the pull copies `pulled` to its local path,
// as `vda pull` does.
function fakeRunner(answers: { shoot?: Answer; pull?: Answer; rm?: Answer; pulled?: string }) {
  const calls: CommandSpec[] = []
  const runner: Runner = {
    async run(spec) {
      calls.push(spec)
      const pick =
        spec.display === SHOOT
          ? answers.shoot
          : spec.display.startsWith(PULL)
            ? answers.pull
            : spec.display === RM
              ? answers.rm
              : undefined
      if (spec.display.startsWith(PULL) && pick === undefined) {
        const local = spec.args.at(-1) ?? ''
        if (answers.pulled === '') await writeFile(local, '')
        else await copyFile(answers.pulled ?? SYNTHETIC, local)
        return done(spec, { stdout: fixture('0.24/vda-pull/pulled.txt') })
      }
      if (pick === undefined) {
        if (spec.display === SHOOT || spec.display === RM) return done(spec, {})
        throw new Error(`unexpected ${spec.display}`)
      }
      if (pick instanceof OvdError) throw pick
      if (typeof pick === 'function') return done(spec, await pick(spec))
      return done(spec, pick)
    }
  }
  return { runner, calls, displays: () => calls.map((c) => c.display) }
}

function done(spec: CommandSpec, fields: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, durationMs: 0, ...fields, command: spec.display }
}

interface Setup {
  target?: Device | null
  // What `devices.get` answers after a failure.
  now?: Device
  runner?: ReturnType<typeof fakeRunner>
  // Each emulator.screenshot call, in order; the last repeats. Default: the recorded PNG.
  shots?: ((signal?: AbortSignal) => Promise<Uint8Array>)[]
  deps?: Partial<ScreenshotDeps>
}

function setup(opts: Setup = {}) {
  const runner = opts.runner ?? fakeRunner({})
  const target = opts.target === undefined ? stick : opts.target
  const missing = () => Promise.reject(new Error('unexpected'))
  const devices: Devices = {
    list: missing,
    currentTarget: async (override) => {
      if (override !== undefined && override !== target?.id) {
        throw new OvdError('DEVICE_NOT_FOUND', `No device ${override}`, 'Check ovd devices')
      }
      return target ? { device: target, source: 'remembered' } : null
    },
    get: async () => {
      const now = opts.now ?? target
      if (!now) throw new Error('no device')
      return now
    },
    rename: missing,
    setTarget: missing,
    invalidate: () => undefined
  }
  const shots = opts.shots ?? [async () => GRPC_PNG]
  const shotCalls: string[] = []
  const ensured: Device[] = []
  const screenshot = createScreenshot({
    runner: runner.runner,
    sdk: createSdkLocator(async () => ({
      vegaPath: '/sdk/vega',
      cli: 'manager',
      sdkVersion: '0.24.12112',
      cliVersion: '1.4.5'
    })),
    devices,
    activity: createActivityLog({ home, surface: 'cli' }),
    emulator: {
      async screenshot(serial, shotOpts) {
        shotCalls.push(serial)
        const shot = shots[Math.min(shotCalls.length, shots.length) - 1]
        if (!shot) throw new Error('no shot')
        return shot(shotOpts?.signal)
      }
    },
    vvd: {
      async ensureGrpc(device) {
        ensured.push(device)
        return { port: 8554 }
      }
    },
    env: { OVD_CAPTURES: captures },
    homedir: root,
    cwd: root,
    platform: 'darwin',
    now: () => AT,
    randomHex: () => HEX,
    ...opts.deps
  })
  return { screenshot, runner, shotCalls, ensured }
}

async function activity(): Promise<Omit<ActivityEntry, 'time' | 'surface'>[]> {
  const text = await readFile(join(home, 'activity.jsonl'), 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const entry: Partial<ActivityEntry> = JSON.parse(line) as ActivityEntry
      delete entry.time
      delete entry.surface
      return entry as Omit<ActivityEntry, 'time' | 'surface'>
    })
}

const files = async (dir = captures) => (await readdir(dir).catch(() => [])).sort()
const NAME = 'vega-virtual-device-20261112-021100.png'
const STICK_NAME = 'living-room-stick-20261112-021100.png'

const grpcOff = () =>
  Promise.reject(
    new OvdError('VVD_GRPC_FAILED', 'Emulator gRPC is off', 'Turn it on', { off: true })
  )

describe('Screenshot.take on the Virtual Device (gRPC)', () => {
  test('saves the PNG in the captures folder (created), one activity entry', async () => {
    const { screenshot, shotCalls, runner } = setup({ target: vvd })
    const result = await screenshot.take()
    expect(result).toEqual({
      target: { id: 'VirtualDevice', name: 'Vega Virtual Device' },
      backend: 'grpc',
      path: join(captures, NAME),
      width: 1920,
      height: 1080,
      bytes: GRPC_PNG.length,
      takenAt: AT.toISOString()
    })
    expect(new Uint8Array(await readFile(result.path))).toEqual(GRPC_PNG)
    expect(await files()).toEqual([NAME])
    expect(shotCalls).toEqual(['emulator-5554'])
    expect(runner.calls).toEqual([])
    expect(await activity()).toEqual([
      { action: 'screenshot', target: 'VirtualDevice', args: { backend: 'grpc' }, result: 'ok' }
    ])
  })

  test('gRPC off: turned on once, then taken', async () => {
    const { screenshot, ensured, shotCalls } = setup({
      target: vvd,
      shots: [grpcOff, async () => GRPC_PNG]
    })
    await expect(screenshot.take()).resolves.toMatchObject({ backend: 'grpc' })
    expect(ensured).toEqual([vvd])
    expect(shotCalls).toHaveLength(2)
  })

  test('an answer that isn’t a PNG is SCREENSHOT_FAILED and saves nothing', async () => {
    const { screenshot } = setup({
      target: vvd,
      shots: [async () => new Uint8Array(Buffer.from('nope'))]
    })
    await expect(screenshot.take()).rejects.toMatchObject({ code: 'SCREENSHOT_FAILED' })
    expect(await files()).toEqual([])
    expect((await activity()).map((a) => [a.action, a.errorCode])).toEqual([
      ['screenshot', 'SCREENSHOT_FAILED']
    ])
  })

  test('Ctrl+C during getScreenshot: an AbortError, no file, no activity entry', async () => {
    const controller = new AbortController()
    const { screenshot } = setup({
      target: vvd,
      shots: [
        (signal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            )
          })
      ]
    })
    const taken = screenshot.take({ signal: controller.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()
    await expect(taken).rejects.toMatchObject({ name: 'AbortError' })
    expect(await files()).toEqual([])
    expect(await activity()).toEqual([])
  })

  test('two takes in the same second keep both files', async () => {
    let n = 0
    const { screenshot } = setup({
      target: vvd,
      deps: { randomHex: () => `0000000${++n}` }
    })
    const [a, b] = await Promise.all([screenshot.take(), screenshot.take()])
    expect(new Set([a.path, b.path])).toEqual(
      new Set([join(captures, NAME), join(captures, 'vega-virtual-device-20261112-021100-2.png')])
    )
    expect(await files()).toHaveLength(2)
  })

  test('a gRPC error on a device that went away is TARGET_OFFLINE', async () => {
    const { screenshot } = setup({
      target: vvd,
      now: { ...vvd, status: 'stopped' },
      shots: [
        () =>
          Promise.reject(
            new OvdError('VVD_GRPC_FAILED', 'Couldn’t reach emulator gRPC', 'Turn it on')
          )
      ]
    })
    await expect(screenshot.take()).rejects.toMatchObject({ code: 'TARGET_OFFLINE' })
  })
})

describe('Screenshot.take on a stick (gwsi-tool-screenshooter)', () => {
  test('screenshooter into a device temp file, pull, rm; the file is saved', async () => {
    const { screenshot, runner } = setup()
    const result = await screenshot.take()
    expect(result).toMatchObject({
      target: { id: stick.id, name: 'Living room stick' },
      backend: 'gwsi-tool-screenshooter',
      path: join(captures, STICK_NAME),
      width: 1920,
      height: 1080,
      bytes: 9780
    })
    const temp = join(captures, `.${STICK_NAME}.${HEX}.part`)
    expect(runner.displays()).toEqual([SHOOT, `${PULL}${temp}`, RM])
    // Its own process group with a 15 s limit, so a hang stops the whole `vega` chain.
    expect(runner.calls[0]?.timeoutMs).toBe(15_000)
    expect(runner.calls[0]?.stopWhen?.('anything')).toBe(false)
    // The clean-up runs even after Ctrl+C: it never carries the signal.
    expect(runner.calls[2]?.signal).toBeUndefined()
    expect(await files()).toEqual([STICK_NAME])
    expect(await activity()).toEqual([
      {
        action: 'screenshot',
        target: stick.id,
        args: { backend: 'gwsi-tool-screenshooter' },
        result: 'ok'
      }
    ])
  })

  test('a remote that isn’t there: SCREENSHOT_FAILED with vda’s reason; rm still runs', async () => {
    const runner = fakeRunner({
      pull: { stdout: fixture('0.24/vda-pull/missing.txt'), exitCode: 1 }
    })
    const { screenshot } = setup({ runner })
    await expect(screenshot.take()).rejects.toMatchObject({
      code: 'SCREENSHOT_FAILED',
      message:
        "Couldn’t pull the screenshot from Living room stick: failed to stat remote object '/tmp/ovd-nope.png': No such file or directory"
    })
    expect(runner.displays().at(-1)).toBe(RM)
    expect(await files()).toEqual([])
  })

  test('an empty screenshot (exit 0, empty file) is SCREENSHOT_FAILED; nothing left', async () => {
    const runner = fakeRunner({ pulled: '' })
    const { screenshot } = setup({ runner })
    await expect(screenshot.take()).rejects.toMatchObject({
      code: 'SCREENSHOT_FAILED',
      message: 'Living room stick gave an empty or invalid screenshot'
    })
    expect(runner.displays().at(-1)).toBe(RM)
    expect(await files()).toEqual([])
  })

  test('a screenshooter that doesn’t finish in 15 s is SCREENSHOT_FAILED; rm still runs', async () => {
    const runner = fakeRunner({
      shoot: new OvdError('COMMAND_FAILED', `${SHOOT} did not finish in time`, 'Check', {
        timedOut: true
      })
    })
    const { screenshot } = setup({ runner })
    await expect(screenshot.take()).rejects.toMatchObject({
      code: 'SCREENSHOT_FAILED',
      message: 'gwsi-tool-screenshooter on Living room stick didn’t finish in 15 s',
      hint: 'Check the device with ovd devices, then retry'
    })
    expect(runner.displays()).toEqual([SHOOT, RM])
    expect(await files()).toEqual([])
  })

  test('the screenshooter’s usage error (exit 1) is SCREENSHOT_FAILED with its last line', async () => {
    const runner = fakeRunner({
      shoot: { stderr: fixture('0.24/gwsi-tool-screenshooter/usage.stderr.txt'), exitCode: 1 }
    })
    const { screenshot } = setup({ runner })
    await expect(screenshot.take()).rejects.toMatchObject({
      code: 'SCREENSHOT_FAILED',
      message: 'gwsi-tool-screenshooter on Living room stick failed: FILENAME must end with .png'
    })
    expect(runner.displays()).toEqual([SHOOT, RM])
  })

  test('a stick VDA no longer lists: TARGET_OFFLINE', async () => {
    const runner = fakeRunner({
      shoot: { stderr: fixture('0.24/vda-shell/stick-usb-not-found.stderr.txt'), exitCode: 1 },
      rm: { stderr: fixture('0.24/vda-shell/stick-usb-not-found.stderr.txt'), exitCode: 1 }
    })
    const { screenshot } = setup({ runner, now: { ...stick, status: 'offline' } })
    await expect(screenshot.take()).rejects.toMatchObject({ code: 'TARGET_OFFLINE' })
    expect((await activity()).map((a) => [a.target, a.errorCode])).toEqual([
      [stick.id, 'TARGET_OFFLINE']
    ])
  })

  test('a failed rm never replaces the outcome', async () => {
    const runner = fakeRunner({ rm: new OvdError('COMMAND_FAILED', 'rm failed', 'Check') })
    const { screenshot } = setup({ runner })
    await expect(screenshot.take()).resolves.toMatchObject({ path: join(captures, STICK_NAME) })
  })

  test('Ctrl+C during the screenshooter: AbortError, rm runs, no file, no entry', async () => {
    const controller = new AbortController()
    const runner = fakeRunner({
      shoot: (spec) =>
        new Promise((_resolve, reject) =>
          spec.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          )
        )
    })
    const { screenshot } = setup({ runner })
    const taken = screenshot.take({ signal: controller.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()
    await expect(taken).rejects.toMatchObject({ name: 'AbortError' })
    expect(runner.displays()).toEqual([SHOOT, RM])
    expect(await files()).toEqual([])
    expect(await activity()).toEqual([])
  })
})

describe('Screenshot.take --out', () => {
  test('a .png file, relative to cwd', async () => {
    const { screenshot } = setup({ target: vvd })
    const result = await screenshot.take({ out: 'shot.png' })
    expect(result.path).toBe(join(root, 'shot.png'))
    expect(await files()).toEqual([])
  })

  test('an existing folder gets the default name', async () => {
    await mkdir(join(root, 'shots'))
    const { screenshot } = setup({ target: vvd })
    expect((await screenshot.take({ out: 'shots' })).path).toBe(join(root, 'shots', NAME))
  })

  test('an existing file without --force: EXPORT_FILE_EXISTS before any SDK call; unchanged', async () => {
    await writeFile(join(root, 'shot.png'), 'mine')
    const { screenshot, shotCalls } = setup({ target: vvd })
    await expect(screenshot.take({ out: 'shot.png' })).rejects.toMatchObject({
      code: 'EXPORT_FILE_EXISTS'
    })
    expect(shotCalls).toEqual([])
    expect(await readFile(join(root, 'shot.png'), 'utf8')).toBe('mine')
    expect(await activity()).toEqual([
      {
        action: 'screenshot',
        target: null,
        args: {},
        result: 'error',
        errorCode: 'EXPORT_FILE_EXISTS'
      }
    ])
  })

  test('--force replaces it', async () => {
    await writeFile(join(root, 'shot.png'), 'mine')
    const { screenshot } = setup({ target: vvd })
    await screenshot.take({ out: 'shot.png', force: true })
    expect(new Uint8Array(await readFile(join(root, 'shot.png')))).toEqual(GRPC_PNG)
  })

  test.each([
    ['shot.jpg', 'INVALID_PATH'],
    ['missing/shot.png', 'PATH_NOT_FOUND']
  ])('%s is %s, before any SDK call', async (out, code) => {
    const { screenshot, shotCalls } = setup({ target: vvd })
    await expect(screenshot.take({ out })).rejects.toMatchObject({ code })
    expect(shotCalls).toEqual([])
  })
})

describe('Screenshot.take without an online target', () => {
  test('offline: TARGET_OFFLINE, nothing run, one entry without a target', async () => {
    const { screenshot, runner } = setup({ target: { ...stick, status: 'offline' } })
    await expect(screenshot.take()).rejects.toMatchObject({ code: 'TARGET_OFFLINE' })
    expect(runner.calls).toEqual([])
    expect(await files()).toEqual([])
    expect(await activity()).toEqual([
      { action: 'screenshot', target: null, args: {}, result: 'error', errorCode: 'TARGET_OFFLINE' }
    ])
  })

  test('none: NO_TARGET', async () => {
    const { screenshot } = setup({ target: null })
    await expect(screenshot.take()).rejects.toMatchObject({ code: 'NO_TARGET' })
  })
})

describe('Screenshot.captures and copy', () => {
  test('lists what take saved; an empty folder before', async () => {
    const { screenshot } = setup({ target: vvd })
    expect(await screenshot.captures()).toEqual({ dir: captures, captures: [] })
    await screenshot.take()
    const list = await screenshot.captures()
    expect(list.captures.map((c) => [c.name, c.width, c.height])).toEqual([[NAME, 1920, 1080]])
    expect(screenshot.dir()).toBe(captures)
  })

  test('copy uses the platform’s clipboard tool', async () => {
    const runs: string[] = []
    const { screenshot } = setup({
      deps: {
        clipboardExec: async (command) => {
          runs.push(command.file)
          return 0
        }
      }
    })
    expect(await screenshot.copy('/tmp/x.png')).toEqual({ tool: 'osascript' })
    expect(runs).toEqual(['osascript'])
    expect(await activity()).toEqual([])
  })
})
