import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  stat,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import type { ActivityEntry, ActivityLog } from '../../src/activity/activityLog.js'
import { acrPullScript, createCrashPull, MAX_ACR_BYTES } from '../../src/crashes/crashPull.js'
import type { Crash } from '../../src/crashes/types.js'
import type { Devices } from '../../src/devices/devices.js'
import type { Device } from '../../src/devices/types.js'
import { createSdkLocator, OvdError } from '../../src/index.js'
import type { CommandSpec, RunResult } from '../../src/sdk/runner.js'
import { fixture } from '../support/fixtures.js'

const SYNTHETIC = new URL('../../../../fixtures/0.24/vda-pull/synthetic-crash.acr', import.meta.url)
const SYNTHETIC_BYTES = 1254
const RECORDED_SIZE = '301471'
const SHELL = 'vega exec vda -s emulator-5554 shell'
const REMOTE_DIR = '/tmp/ovd-acr.aB3dE9'
const RM = `${SHELL} rm -rf ${REMOTE_DIR}`
const EPOCH = 1794102704
const NAME = `com.example.player-${EPOCH}-3200.acr`

const device: Device = {
  id: 'VirtualDevice',
  vdaSerial: 'emulator-5554',
  name: 'Vega Virtual Device',
  kind: 'vvd',
  connection: 'local',
  status: 'online',
  isTarget: true,
  saved: false
}

const crash: Crash = {
  id: 37,
  package: 'com.example.player',
  kind: 'js',
  signal: 6,
  signalName: 'SIGABRT',
  pid: 3200,
  time: new Date(EPOCH * 1000).toISOString(),
  new: true
}

let root: string
let crashes: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ovd-crash-pull-'))
  crashes = join(root, 'crashes')
})

type Answer = Partial<RunResult> | OvdError | ((spec: CommandSpec) => Promise<Partial<RunResult>>)

interface Setup {
  script?: Answer
  pull?: Answer
  rm?: Answer
  // What `vda pull` writes locally.
  pulled?: string | Buffer
  find?: () => Promise<{ crash: Crash }>
  activity?: ActivityLog
}

const scriptOut = (content = 'ok', size = String(SYNTHETIC_BYTES)) =>
  fixture(`0.24/loggingctl-vault-acr/pull-script-${content}.txt`).replaceAll(RECORDED_SIZE, size)

function setup(opts: Setup = {}) {
  const calls: CommandSpec[] = []
  const appended: Omit<ActivityEntry, 'time' | 'surface'>[] = []
  const answer = async (
    spec: CommandSpec,
    pick: Answer | undefined,
    fallback: Partial<RunResult>
  ) => {
    if (pick instanceof OvdError) throw pick
    const fields = typeof pick === 'function' ? await pick(spec) : (pick ?? fallback)
    return { stdout: '', stderr: '', exitCode: 0, durationMs: 0, ...fields, command: spec.display }
  }
  const runner = {
    async run(spec: CommandSpec): Promise<RunResult> {
      calls.push(spec)
      if (spec.display.includes('base64 -d')) {
        return answer(spec, opts.script, { stdout: scriptOut() })
      }
      if (spec.display.startsWith(`${SHELL} rm -rf`)) return answer(spec, opts.rm, {})
      if (spec.display.startsWith('vega exec vda -s emulator-5554 pull ')) {
        const local = spec.args.at(-1) ?? ''
        if (opts.pulled === undefined) await copyFile(SYNTHETIC, local)
        else await writeFile(local, opts.pulled)
        return answer(spec, opts.pull, { stdout: fixture('0.24/vda-pull/acr.txt') })
      }
      throw new Error(`unexpected ${spec.display}`)
    }
  }
  const no = () => Promise.reject(new Error('not used'))
  const devices: Devices = {
    list: no,
    get: no,
    rename: no,
    setTarget: no,
    invalidate: () => undefined,
    currentTarget: async () => ({ device, source: 'flag' })
  }
  const activity: ActivityLog = opts.activity ?? {
    append: async (entry) => void appended.push(entry)
  }
  const found: string[] = []
  const pull = createCrashPull({
    reader: {
      find: async (id) => {
        found.push(String(id))
        const detail = opts.find ? await opts.find() : { crash }
        return { ...detail, stack: [], device }
      }
    },
    runner,
    sdk: createSdkLocator(async () => ({
      vegaPath: '/sdk/vega',
      cli: 'manager',
      sdkVersion: '0.24.12112',
      cliVersion: '1.4.5'
    })),
    devices,
    activity,
    env: { OVD_CRASHES: crashes },
    homedir: root,
    cwd: root
  })
  return { pull, calls, appended, found, displays: () => calls.map((c) => c.display) }
}

const files = async (dir = crashes) => (await readdir(dir).catch(() => [])).sort()

describe('acrPullScript', () => {
  test('is the recorded script text, with the index', () => {
    expect(acrPullScript(37)).toBe(
      'umask 077; d=$(mktemp -d /tmp/ovd-acr.XXXXXX) || exit 1; f="$d/report.acr"; loggingctl vault --cat SYSTEM_TOMBSTONE 37 > "$f"; echo "$f"; wc -c < "$f"; ls -ld "$d" "$f"'
    )
  })

  test.each([-1, 1.5, Number.NaN])('refuses %s', (n) => {
    expect(() => acrPullScript(n)).toThrow()
  })
})

describe('crashes.pull', () => {
  test('saves a 0600 file in a 0700 folder under the OVD-built name and removes the remote folder', async () => {
    const { pull, displays, appended } = setup()
    const result = await pull.pull({ id: '37' })
    expect(result).toEqual({ crash, path: join(crashes, NAME), bytes: SYNTHETIC_BYTES })
    expect(await files()).toEqual([NAME])
    expect((await stat(crashes)).mode & 0o777).toBe(0o700)
    expect((await stat(result.path)).mode & 0o777).toBe(0o600)
    expect(await readFile(result.path)).toEqual(await readFile(SYNTHETIC))
    const [script, pulled, rm] = displays()
    expect(script).toMatch(new RegExp(`^${SHELL} echo [A-Za-z0-9+/=]+ \\| base64 -d \\| sh$`))
    expect(pulled).toMatch(
      new RegExp(
        `^vega exec vda -s emulator-5554 pull ${REMOTE_DIR}/report.acr ${crashes}/\\.ovd-pull-[A-Za-z0-9]{6}/pull\\.acr\\.part$`
      )
    )
    expect(rm).toBe(RM)
    expect(displays()).toHaveLength(3)
    expect(appended).toEqual([
      {
        action: 'crash.pull',
        target: 'VirtualDevice',
        args: {
          package: 'com.example.player',
          index: 37,
          pid: 3200,
          signal: 6,
          bytes: SYNTHETIC_BYTES
        },
        result: 'ok'
      }
    ])
  })

  test('the device script is the base64 of the recorded text', async () => {
    const { pull, calls } = setup()
    await pull.pull({ id: 37 })
    const encoded = /echo (\S+) \|/.exec(calls[0]?.args.at(-1) ?? '')?.[1] ?? ''
    expect(Buffer.from(encoded, 'base64').toString()).toBe(acrPullScript(37))
  })

  test('--out folder and --out file, relative to cwd', async () => {
    const a = setup()
    expect((await a.pull.pull({ id: 37, out: 'report.acr' })).path).toBe(join(root, 'report.acr'))
    const b = setup()
    expect((await b.pull.pull({ id: 37, out: root })).path).toBe(join(root, NAME))
    expect(await files(crashes)).toEqual([])
  })

  test('an existing --out file needs --force, and is refused before any SDK call', async () => {
    const out = join(root, 'report.acr')
    await writeFile(out, 'mine')
    const refused = setup()
    await expect(refused.pull.pull({ id: 37, out })).rejects.toMatchObject({
      code: 'EXPORT_FILE_EXISTS'
    })
    expect(refused.calls).toEqual([])
    expect(refused.appended).toMatchObject([
      { action: 'crash.pull', result: 'error', errorCode: 'EXPORT_FILE_EXISTS' }
    ])
    expect(await readFile(out, 'utf8')).toBe('mine')
    const forced = setup()
    await forced.pull.pull({ id: 37, out, force: true })
    expect((await readFile(out)).length).toBe(SYNTHETIC_BYTES)
  })

  test('--out must be a .acr file', async () => {
    const { pull, calls } = setup()
    await expect(pull.pull({ id: 37, out: join(root, 'r.png') })).rejects.toMatchObject({
      code: 'INVALID_PATH',
      message: '--out must be a .acr file or a folder'
    })
    expect(calls).toEqual([])
  })

  test('a second pull of the same report gets -2', async () => {
    const { pull } = setup()
    await pull.pull({ id: 37 })
    const second = await pull.pull({ id: 37 })
    expect(second.path).toBe(join(crashes, `com.example.player-${EPOCH}-3200-2.acr`))
  })

  test.each(['x', '-1', '1.5', '', '07', '1e3', '99999999999'])(
    'id %j is INVALID_CRASH_ID, no calls',
    async (id) => {
      const { pull, calls, found } = setup()
      await expect(pull.pull({ id })).rejects.toMatchObject({ code: 'INVALID_CRASH_ID' })
      expect(calls).toEqual([])
      expect(found).toEqual([])
    }
  )

  test('an out-of-scope id (CRASH_NOT_FOUND from the reader) runs nothing on the device', async () => {
    const { pull, calls, appended } = setup({
      find: () => Promise.reject(new OvdError('CRASH_NOT_FOUND', 'No crash 5', 'List them'))
    })
    await expect(pull.pull({ id: 5 })).rejects.toMatchObject({ code: 'CRASH_NOT_FOUND' })
    expect(calls).toEqual([])
    expect(await files()).toEqual([])
    expect(appended).toMatchObject([
      {
        action: 'crash.pull',
        target: 'VirtualDevice',
        args: { index: '5' },
        errorCode: 'CRASH_NOT_FOUND'
      }
    ])
  })

  test('-8 (unknown index) in the file is CRASH_NOT_FOUND, with no file and the remote folder removed', async () => {
    const { pull, displays } = setup({
      script: { stdout: scriptOut('unknown-index', '79') },
      pulled: fixture('0.24/loggingctl-vault-acr/unknown-index.json')
    })
    await expect(pull.pull({ id: 37 })).rejects.toMatchObject({ code: 'CRASH_NOT_FOUND' })
    expect(await files()).toEqual([])
    expect(displays().at(-1)).toBe(`${SHELL} rm -rf /tmp/ovd-acr.cD4fG8`)
  })

  test('-7 (uninstalled) in the file is CRASH_ACCESS_DENIED, with no file and the remote folder removed', async () => {
    const { pull, displays, appended } = setup({
      script: { stdout: scriptOut('uninstalled', '56') },
      pulled: fixture('0.24/loggingctl-vault-acr/insufficient-permissions.json')
    })
    await expect(pull.pull({ id: 37 })).rejects.toMatchObject({ code: 'CRASH_ACCESS_DENIED' })
    expect(await files()).toEqual([])
    expect(displays().at(-1)).toBe(`${SHELL} rm -rf /tmp/ovd-acr.eF5hJ7`)
    expect(appended).toMatchObject([{ result: 'error', errorCode: 'CRASH_ACCESS_DENIED' }])
  })

  test('a failed vda pull is CRASH_PULL_FAILED and the remote folder is still removed', async () => {
    const { pull, displays } = setup({
      pull: { stdout: fixture('0.24/vda-pull/missing.txt'), exitCode: 1 }
    })
    await expect(pull.pull({ id: 37 })).rejects.toMatchObject({ code: 'CRASH_PULL_FAILED' })
    expect(displays().at(-1)).toBe(RM)
    expect(await files()).toEqual([])
  })

  test('an empty pulled file is CRASH_PULL_FAILED', async () => {
    const { pull } = setup({ pulled: '', script: { stdout: scriptOut('ok', '0') } })
    await expect(pull.pull({ id: 37 })).rejects.toMatchObject({ code: 'CRASH_PULL_FAILED' })
    expect(await files()).toEqual([])
  })

  test('a file that isn’t an ACR is CRASH_PULL_FAILED', async () => {
    const body = 'this is not a report\n'
    const { pull } = setup({
      pulled: body,
      script: { stdout: scriptOut('ok', String(body.length)) }
    })
    await expect(pull.pull({ id: 37 })).rejects.toMatchObject({ code: 'CRASH_PULL_FAILED' })
    expect(await files()).toEqual([])
  })

  test('a pulled size that differs from wc -c is CRASH_PULL_FAILED', async () => {
    const { pull } = setup({ script: { stdout: scriptOut('ok', '1253') } })
    await expect(pull.pull({ id: 37 })).rejects.toMatchObject({ code: 'CRASH_PULL_FAILED' })
    expect(await files()).toEqual([])
  })

  test('a report over 4 MiB is refused before the pull, and the remote folder removed', async () => {
    const { pull, displays } = setup({
      script: { stdout: scriptOut('ok', String(MAX_ACR_BYTES + 1)) }
    })
    await expect(pull.pull({ id: 37 })).rejects.toMatchObject({ code: 'CRASH_PULL_FAILED' })
    expect(displays().some((d) => d.includes(' pull '))).toBe(false)
    expect(displays().at(-1)).toBe(RM)
    await expect(stat(crashes)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('a local file over 4 MiB is refused whatever the device said', async () => {
    const big = Buffer.alloc(MAX_ACR_BYTES + 1, 'a')
    const { pull } = setup({ pulled: big, script: { stdout: scriptOut('ok', '100') } })
    await expect(pull.pull({ id: 37 })).rejects.toMatchObject({ code: 'CRASH_PULL_FAILED' })
    expect(await files()).toEqual([])
  })

  test.each([
    ['a path outside /tmp', '/etc/ovd-acr.aB3dE9/report.acr\n10\n'],
    ['a path with ..', '/tmp/ovd-acr.aB3dE9/../../report.acr\n10\n'],
    ['a path with a space', '/tmp/ovd-acr.aB3dE9 /x/report.acr\n10\n'],
    ['nothing', '']
  ])(
    'an unexpected script answer (%s) is CRASH_PULL_FAILED and nothing is removed or pulled',
    async (_n, stdout) => {
      const { pull, displays } = setup({ script: { stdout } })
      await expect(pull.pull({ id: 37 })).rejects.toMatchObject({ code: 'CRASH_PULL_FAILED' })
      expect(displays()).toHaveLength(1)
    }
  )

  test('an answer with a valid file but no size removes its folder and pulls nothing', async () => {
    const { pull, displays } = setup({ script: { stdout: '/tmp/ovd-acr.aB3dE9/report.acr\n' } })
    await expect(pull.pull({ id: 37 })).rejects.toMatchObject({ code: 'CRASH_PULL_FAILED' })
    expect(displays().map((d) => d.includes(' pull '))).toEqual([false, false])
    expect(displays().at(-1)).toBe(RM)
  })

  test('a script that failed after mktemp still removes its folder', async () => {
    const { pull, displays } = setup({
      script: { stdout: '/tmp/ovd-acr.aB3dE9/report.acr\n', exitCode: 1 }
    })
    await expect(pull.pull({ id: 37 })).rejects.toMatchObject({ code: 'CRASH_PULL_FAILED' })
    expect(displays().at(-1)).toBe(RM)
  })

  test('Ctrl+C during the pull: an AbortError, nothing saved or logged, the folder removed without the signal', async () => {
    const controller = new AbortController()
    const { pull, calls, appended } = setup({
      pull: async () => {
        controller.abort()
        throw new OvdError('COMMAND_FAILED', 'aborted', 'x')
      }
    })
    await expect(pull.pull({ id: 37, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(await files()).toEqual([])
    expect(appended).toEqual([])
    const rm = calls.at(-1)
    expect(rm?.display).toBe(RM)
    expect(rm?.signal).toBeUndefined()
  })

  test('Ctrl+C during the device script: the folder is still removed, AbortError, nothing saved or logged', async () => {
    const controller = new AbortController()
    const { pull, calls, appended } = setup({
      script: async () => {
        controller.abort()
        return { stdout: scriptOut() }
      }
    })
    await expect(pull.pull({ id: 37, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError'
    })
    // The script never carries the signal, so its output (the folder) is always obtained.
    expect(calls[0]?.signal).toBeUndefined()
    expect(calls[0]?.timeoutMs).toBeGreaterThan(0)
    expect(calls.at(-1)?.display).toBe(RM)
    expect(calls.some((c) => c.display.includes(' pull '))).toBe(false)
    expect(await files()).toEqual([])
    expect(appended).toEqual([])
  })

  test('a timeout during the device script is CRASH_PULL_FAILED, nothing is pulled or left on the host', async () => {
    const { pull, calls } = setup({
      script: new OvdError('COMMAND_FAILED', 'did not finish in time', 'Check', { timedOut: true })
    })
    await expect(pull.pull({ id: 37 })).rejects.toMatchObject({ code: 'CRASH_PULL_FAILED' })
    expect(calls).toHaveLength(1)
    expect(await files()).toEqual([])
    await expect(stat(crashes)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('Ctrl+C during the remote cleanup: nothing is published or logged, staging removed', async () => {
    const controller = new AbortController()
    const { pull, appended } = setup({
      rm: async () => {
        controller.abort()
        return {}
      }
    })
    await expect(pull.pull({ id: 37, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect(await files()).toEqual([])
    expect(appended).toEqual([])
  })

  test('the pull goes into a private 0700 staging folder, removed afterwards', async () => {
    let folderMode = 0
    let parent = ''
    const { pull } = setup({
      pull: async (spec) => {
        const local = spec.args.at(-1) ?? ''
        parent = dirname(dirname(local))
        folderMode = (await lstat(dirname(local))).mode & 0o777
        return { stdout: fixture('0.24/vda-pull/acr.txt') }
      }
    })
    await pull.pull({ id: 37 })
    expect(folderMode).toBe(0o700)
    expect(parent).toBe(crashes)
    expect(await files()).toEqual([NAME])
  })

  test('a link planted where the SDK writes is refused, its target untouched, staging removed', async () => {
    await mkdir(crashes)
    await writeFile(join(root, 'victim'), 'precious')
    const { pull, displays } = setup({
      pull: async (spec) => {
        // Replaces what the fake pull just wrote with a link, as a racing process could.
        await unlink(spec.args.at(-1) ?? '')
        await symlink(join(root, 'victim'), spec.args.at(-1) ?? '')
        return { stdout: fixture('0.24/vda-pull/acr.txt') }
      }
    })
    await expect(pull.pull({ id: 37 })).rejects.toMatchObject({ code: 'CRASH_PULL_FAILED' })
    expect(await readFile(join(root, 'victim'), 'utf8')).toBe('precious')
    expect(await files()).toEqual([])
    expect(displays().at(-1)).toBe(RM)
  })

  test('a link planted at the old guessable temp name is never written through', async () => {
    await mkdir(crashes)
    await writeFile(join(root, 'victim'), 'precious')
    await symlink(join(root, 'victim'), join(crashes, `.${NAME}.0123abcd.part`))
    const { pull } = setup()
    await pull.pull({ id: 37 })
    expect(await readFile(join(root, 'victim'), 'utf8')).toBe('precious')
  })

  test('--out into a symlinked folder is accepted and written to the real folder', async () => {
    const real = join(root, 'real')
    await mkdir(real)
    await symlink(real, join(root, 'linked'))
    const { pull } = setup()
    const result = await pull.pull({ id: 37, out: join(root, 'linked') })
    expect(result.path).toBe(join(await realpath(real), NAME))
    expect(await files(real)).toEqual([NAME])
  })

  test('--out onto a symlinked file is refused before any SDK call', async () => {
    await writeFile(join(root, 'victim.acr'), 'precious')
    await symlink(join(root, 'victim.acr'), join(root, 'r.acr'))
    const { pull, calls } = setup()
    await expect(pull.pull({ id: 37, out: 'r.acr', force: true })).rejects.toMatchObject({
      code: 'INVALID_PATH'
    })
    expect(calls).toEqual([])
    expect(await readFile(join(root, 'victim.acr'), 'utf8')).toBe('precious')
  })

  test('a symlinked default crashes folder is refused and nothing is written through it', async () => {
    const real = join(root, 'real')
    await mkdir(real)
    await symlink(real, crashes)
    const { pull } = setup()
    await expect(pull.pull({ id: 37 })).rejects.toMatchObject({ code: 'INVALID_PATH' })
    expect(await files(real)).toEqual([])
  })

  test('the activity log never holds report text', async () => {
    const { pull, appended } = setup()
    await pull.pull({ id: 37 })
    expect(JSON.stringify(appended)).not.toMatch(/BootId|Source|Error:|\/tmp/)
  })
})
