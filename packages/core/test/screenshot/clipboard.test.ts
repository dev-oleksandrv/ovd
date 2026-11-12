import { describe, expect, test } from 'vitest'
import { createClipboard, type ClipboardCommand } from '../../src/index.js'

const PATH = '/home/developer/ovd/captures/vega-virtual-device-20261112-021100.png'

function setup(opts: {
  platform: NodeJS.Platform
  env?: Record<string, string>
  // Executables on PATH, by full path.
  bins?: string[]
  exitCode?: number | Error
}) {
  const runs: { command: ClipboardCommand; timeoutMs: number }[] = []
  const clipboard = createClipboard({
    platform: opts.platform,
    env: { PATH: '/usr/local/bin:/usr/bin', ...opts.env },
    isExecutable: async (path) => (opts.bins ?? []).includes(path),
    exec: async (command, timeoutMs) => {
      runs.push({ command, timeoutMs })
      if (opts.exitCode instanceof Error) throw opts.exitCode
      return opts.exitCode ?? 0
    }
  })
  return { clipboard, runs }
}

describe('Clipboard.copyPng', () => {
  test('macOS: osascript with the path as an argument, never in the script', async () => {
    const { clipboard, runs } = setup({ platform: 'darwin' })
    expect(await clipboard.copyPng(PATH)).toEqual({ tool: 'osascript' })
    expect(runs).toEqual([
      {
        command: {
          file: 'osascript',
          args: [
            '-e',
            'on run argv',
            '-e',
            'set the clipboard to (read (POSIX file (item 1 of argv)) as «class PNGf»)',
            '-e',
            'end run',
            PATH
          ]
        },
        timeoutMs: 5_000
      }
    ])
  })

  test('a path with quotes stays one argument', async () => {
    const { clipboard, runs } = setup({ platform: 'darwin' })
    const odd = '/tmp/a "b" \\ c.png'
    await clipboard.copyPng(odd)
    expect(runs[0]?.command.args.at(-1)).toBe(odd)
    expect(runs[0]?.command.args.slice(0, -1).join(' ')).not.toContain(odd)
  })

  test('Wayland: wl-copy with the file on stdin', async () => {
    const { clipboard, runs } = setup({
      platform: 'linux',
      env: { WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' },
      bins: ['/usr/bin/wl-copy', '/usr/bin/xclip']
    })
    expect(await clipboard.copyPng(PATH)).toEqual({ tool: 'wl-copy' })
    expect(runs[0]?.command).toEqual({
      file: 'wl-copy',
      args: ['--type', 'image/png'],
      stdinFile: PATH
    })
  })

  test('X11: xclip reads the file', async () => {
    const { clipboard, runs } = setup({
      platform: 'linux',
      env: { DISPLAY: ':0' },
      bins: ['/usr/local/bin/xclip']
    })
    expect(await clipboard.copyPng(PATH)).toEqual({ tool: 'xclip' })
    expect(runs[0]?.command).toEqual({
      file: 'xclip',
      args: ['-selection', 'clipboard', '-t', 'image/png', '-i', PATH]
    })
  })

  test('Wayland without wl-copy falls back to xclip under XWayland', async () => {
    const { clipboard } = setup({
      platform: 'linux',
      env: { WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' },
      bins: ['/usr/bin/xclip']
    })
    expect(await clipboard.copyPng(PATH)).toEqual({ tool: 'xclip' })
  })

  test.each([
    ['no display', {}, ['/usr/bin/xclip', '/usr/bin/wl-copy']],
    ['an empty DISPLAY', { DISPLAY: '' }, ['/usr/bin/xclip']],
    ['no tool', { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' }, []]
  ])('Linux with %s: CLIPBOARD_UNAVAILABLE, nothing run', async (_name, env, bins) => {
    const { clipboard, runs } = setup({ platform: 'linux', env, bins })
    await expect(clipboard.copyPng(PATH)).rejects.toMatchObject({
      code: 'CLIPBOARD_UNAVAILABLE',
      hint: 'Install xclip (X11) or wl-clipboard (Wayland), then retry'
    })
    expect(runs).toEqual([])
  })

  test.each([[1], [new Error('spawn failed')]])(
    'a tool that fails (%s) is CLIPBOARD_UNAVAILABLE',
    async (exitCode) => {
      const { clipboard } = setup({ platform: 'darwin', exitCode })
      await expect(clipboard.copyPng(PATH)).rejects.toMatchObject({
        code: 'CLIPBOARD_UNAVAILABLE',
        message: 'osascript couldn’t copy the screenshot'
      })
    }
  )
})
