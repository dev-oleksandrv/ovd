import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, test } from 'vitest'
import { STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'
import { ovd } from '../harness/cli.ts'
import { createSandbox } from '../harness/vitest.ts'

const SYNTHETIC = readFileSync(
  new URL('../../fixtures/0.24/vda-pull/synthetic-screenshot.png', import.meta.url)
)
const VVD = ['--device', 'VirtualDevice']
const SHOOTER = new RegExp(
  `^vega exec vda -s ${STICK_SERIAL} shell gwsi-tool-screenshooter (/tmp/ovd-screenshot-[0-9a-f]{8}\\.png)$`
)
const NAME = /^[a-z0-9-]+-\d{8}-\d{6}(-\d+)?\.png$/

interface Shot {
  target: { id: string; name: string }
  backend: string
  path: string
  width: number
  height: number
  bytes: number
  takenAt: string
  copied: boolean
}

const pngs = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort() : [])

// The stick's SDK calls for one screenshot: the screenshooter, the pull and the clean-up of one
// device temp file.
function stickCalls(calls: string[]): { remote: string; screenshot: string[] } {
  const shooter = calls.find((c) => SHOOTER.test(c)) ?? ''
  const remote = SHOOTER.exec(shooter)?.[1] ?? ''
  return { remote, screenshot: calls.filter((c) => c.includes(remote) && remote !== '') }
}

describe('ovd screenshot on the Virtual Device (gRPC)', () => {
  test('saves the PNG from getScreenshot in the captures folder, gRPC turned on once', async () => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['screenshot', ...VVD, '--json'])

    expect(run.exitCode).toBe(0)
    const shot = run.json<{ ok: true; screenshot: Shot }>().screenshot
    expect(shot).toMatchObject({
      target: { id: 'VirtualDevice', name: 'Vega Virtual Device' },
      backend: 'grpc',
      width: 1920,
      height: 1080,
      copied: false
    })
    expect(shot.path.startsWith(`${sandbox.captures}/vega-virtual-device-`)).toBe(true)
    expect(pngs(sandbox.captures)).toEqual([shot.path.split('/').at(-1)])
    expect(readFileSync(shot.path).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(readFileSync(shot.path).length).toBe(shot.bytes)
    // gRPC was off (the Virtual Device wasn't started by OVD): turned on, then one screenshot.
    expect(sandbox.grpcCalls()).toEqual([{ method: 'getScreenshot' }])
    expect(sandbox.activity().map((a) => [a.action, a.result, a.args])).toEqual([
      ['vvd.grpc.enable', 'ok', expect.anything()],
      ['screenshot', 'ok', { backend: 'grpc' }]
    ])
    // No SDK command takes a Virtual Device screenshot.
    expect(
      sandbox.calls().filter((c) => c.includes('screenshooter') || c.includes(' pull '))
    ).toEqual([])
  })

  test('two screenshots in a row keep both files', async () => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()

    expect((await ovd(sandbox, ['screenshot', ...VVD])).exitCode).toBe(0)
    expect((await ovd(sandbox, ['screenshot', ...VVD])).exitCode).toBe(0)

    const files = pngs(sandbox.captures)
    expect(files).toHaveLength(2)
    for (const file of files) expect(file).toMatch(NAME)
  })
})

describe('ovd screenshot on a stick (gwsi-tool-screenshooter)', () => {
  test('takes it into a device temp file, pulls it, removes it; the PNG is saved', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['screenshot', '--json'])

    expect(run.exitCode).toBe(0)
    const shot = run.json<{ ok: true; screenshot: Shot }>().screenshot
    expect(shot).toMatchObject({
      target: { id: STICK_SERIAL, name: 'Fire TV stick' },
      backend: 'gwsi-tool-screenshooter',
      width: 1920,
      height: 1080,
      bytes: SYNTHETIC.length
    })
    expect(readFileSync(shot.path).equals(SYNTHETIC)).toBe(true)
    const { remote, screenshot } = stickCalls(sandbox.calls())
    expect(screenshot).toEqual([
      `vega exec vda -s ${STICK_SERIAL} shell gwsi-tool-screenshooter ${remote}`,
      expect.stringMatching(
        new RegExp(
          `^vega exec vda -s ${STICK_SERIAL} pull ${remote} ${sandbox.captures}/\\.fire-tv-stick-\\d{8}-\\d{6}\\.png\\.[0-9a-f]{8}\\.part$`
        )
      ),
      `vega exec vda -s ${STICK_SERIAL} shell rm -f ${remote}`
    ])
    // Nothing left on the device, and no temp file on the host.
    expect(sandbox.world().stickFiles).toEqual([])
    expect(pngs(sandbox.captures)).toEqual([shot.path.split('/').at(-1)])
    expect(sandbox.activity()).toEqual([
      expect.objectContaining({
        surface: 'cli',
        action: 'screenshot',
        target: STICK_SERIAL,
        args: { backend: 'gwsi-tool-screenshooter' },
        result: 'ok'
      })
    ])
  })

  test('an empty screenshot exits 1 SCREENSHOT_FAILED; nothing saved, the device file removed', async () => {
    const sandbox = createSandbox({ stick: usbStick(), stickScreenshot: 'empty' })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['screenshot', '--json'])

    expect(run.exitCode).toBe(1)
    expect(run.json()).toMatchObject({
      ok: false,
      error: {
        code: 'SCREENSHOT_FAILED',
        message: 'Fire TV stick gave an empty or invalid screenshot'
      }
    })
    expect(pngs(sandbox.captures)).toEqual([])
    const { remote, screenshot } = stickCalls(sandbox.calls())
    expect(screenshot.at(-1)).toBe(`vega exec vda -s ${STICK_SERIAL} shell rm -f ${remote}`)
    expect(sandbox.world().stickFiles).toEqual([])
    expect(sandbox.activity().map((a) => [a.action, a.result, a.errorCode])).toEqual([
      ['screenshot', 'error', 'SCREENSHOT_FAILED']
    ])
  })

  test('an offline target exits 4 TARGET_OFFLINE with nothing run or written', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    sandbox.installSdk()
    expect((await ovd(sandbox, ['target', 'set', STICK_SERIAL])).exitCode).toBe(0)
    sandbox.update((w) => {
      if (w.stick) w.stick.usbCable = false
    })
    sandbox.clearCalls()

    const run = await ovd(sandbox, ['screenshot', '--json'])

    expect(run.exitCode).toBe(4)
    expect(run.json()).toMatchObject({ ok: false, error: { code: 'TARGET_OFFLINE' } })
    expect(
      sandbox.calls().filter((c) => c.includes('screenshooter') || c.includes(' pull '))
    ).toEqual([])
    expect(existsSync(sandbox.captures)).toBe(false)
    expect(sandbox.activity().filter((a) => a.action === 'screenshot')).toEqual([
      expect.objectContaining({ target: null, result: 'error', errorCode: 'TARGET_OFFLINE' })
    ])
  })
})

describe('ovd screenshot --out', () => {
  test('a file, relative to the working folder, and a folder', async () => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()
    mkdirSync(join(sandbox.home, 'shots'))

    const file = await ovd(sandbox, ['screenshot', ...VVD, '--out', 'shot.png', '--json'])
    const folder = await ovd(sandbox, ['screenshot', ...VVD, '--out', 'shots', '--json'])

    // The working folder as the process sees it (macOS resolves /var to /private/var).
    const cwd = realpathSync(sandbox.home)
    expect(file.json<{ screenshot: Shot }>().screenshot.path).toBe(join(cwd, 'shot.png'))
    expect(readFileSync(join(sandbox.home, 'shot.png')).subarray(1, 4).toString()).toBe('PNG')
    const inFolder = folder.json<{ screenshot: Shot }>().screenshot.path
    expect(inFolder.startsWith(join(cwd, 'shots', 'vega-virtual-device-'))).toBe(true)
    expect(pngs(sandbox.captures)).toEqual([])
  })

  test('an existing file without --force exits 2 and stays; --force replaces it', async () => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()
    const path = join(sandbox.home, 'shot.png')
    writeFileSync(path, 'mine')

    const refused = await ovd(sandbox, ['screenshot', ...VVD, '--out', 'shot.png', '--json'])

    expect(refused.exitCode).toBe(2)
    expect(refused.json()).toMatchObject({ ok: false, error: { code: 'EXPORT_FILE_EXISTS' } })
    expect(readFileSync(path, 'utf8')).toBe('mine')
    expect(sandbox.grpcCalls()).toEqual([])

    const forced = await ovd(sandbox, ['screenshot', ...VVD, '--out', 'shot.png', '--force'])
    expect(forced.exitCode).toBe(0)
    expect(readFileSync(path).subarray(1, 4).toString()).toBe('PNG')
  })

  test('not a .png exits 2 INVALID_PATH before any SDK call', async () => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['screenshot', ...VVD, '--out', 'shot.jpg', '--json'])

    expect(run.exitCode).toBe(2)
    expect(run.json()).toMatchObject({ error: { code: 'INVALID_PATH' } })
    expect(sandbox.calls()).toEqual([])
  })
})

describe('ovd screenshot --clipboard', () => {
  const take = async (env: Record<string, string>) => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()
    const run = await ovd(sandbox, ['screenshot', ...VVD, '--clipboard', '--json'], { env })
    return { sandbox, run }
  }

  it.runIf(process.platform === 'darwin')(
    'macOS: osascript gets the saved file as its argument',
    async () => {
      const { sandbox, run } = await take({})
      expect(run.exitCode).toBe(0)
      const shot = run.json<{ screenshot: Shot }>().screenshot
      expect(shot.copied).toBe(true)
      expect(sandbox.clipboardCalls()).toEqual([
        {
          tool: 'osascript',
          args: [
            '-e',
            'on run argv',
            '-e',
            'set the clipboard to (read (POSIX file (item 1 of argv)) as «class PNGf»)',
            '-e',
            'end run',
            shot.path
          ],
          stdinBytes: 0
        }
      ])
    }
  )

  it.runIf(process.platform === 'linux')('X11: xclip reads the saved file', async () => {
    const { sandbox, run } = await take({ DISPLAY: ':99', WAYLAND_DISPLAY: '' })
    expect(run.exitCode).toBe(0)
    const shot = run.json<{ screenshot: Shot }>().screenshot
    expect(sandbox.clipboardCalls()).toEqual([
      {
        tool: 'xclip',
        args: ['-selection', 'clipboard', '-t', 'image/png', '-i', shot.path],
        stdinBytes: 0
      }
    ])
  })

  it.runIf(process.platform === 'linux')('Wayland: wl-copy gets the PNG on stdin', async () => {
    const { sandbox, run } = await take({ WAYLAND_DISPLAY: 'wayland-0' })
    expect(run.exitCode).toBe(0)
    const shot = run.json<{ screenshot: Shot }>().screenshot
    expect(sandbox.clipboardCalls()).toEqual([
      { tool: 'wl-copy', args: ['--type', 'image/png'], stdinBytes: shot.bytes }
    ])
  })

  it.runIf(process.platform === 'linux')(
    'no display: exits 1 CLIPBOARD_UNAVAILABLE, the file still saved',
    async () => {
      const { sandbox, run } = await take({ DISPLAY: '', WAYLAND_DISPLAY: '' })
      expect(run.exitCode).toBe(1)
      const doc = run.json<{ error: { code: string; message: string }; screenshot: Shot }>()
      expect(doc.error.code).toBe('CLIPBOARD_UNAVAILABLE')
      expect(doc.error.message).toContain(`Saved ${doc.screenshot.path}`)
      expect(existsSync(doc.screenshot.path)).toBe(true)
      expect(sandbox.clipboardCalls()).toEqual([])
    }
  )
})
