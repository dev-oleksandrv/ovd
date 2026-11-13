// @vitest-environment node
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OvdError, type Crash, type Ovd } from '@ovd/core'
import { beforeEach, describe, expect, test, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
const writeText = vi.fn()
const showItemInFolder = vi.fn()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) },
  clipboard: { writeText: (text: string) => writeText(text) },
  shell: { showItemInFolder: (path: string) => showItemInFolder(path) }
}))

const { registerCrashesIpc } = await import('../../src/main/crashesIpc')
const { channels } = await import('../../src/preload/api')

const crash: Crash = {
  id: 7,
  package: 'com.example.player',
  kind: 'js',
  signal: 6,
  signalName: 'SIGABRT',
  pid: 3200,
  time: '2026-11-13T10:00:00.000Z',
  summary: 'Error: boom',
  new: false
}
const ref = { device: 'VirtualDevice', id: 7 }

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'ovd-crashes-ipc-'))
  const dir = join(root, 'crashes')
  await mkdir(dir)
  let n = 0
  const pull = vi.fn(async () => {
    const path = join(dir, `com.example.player-1-3200${n++ === 0 ? '' : `-${n}`}.acr`)
    await writeFile(path, 'CrashLang: JavaScript\n')
    return { crash, path, bytes: 22 }
  })
  const detail = vi.fn(async () => ({
    crash,
    reason: 'abort',
    stack: ['Error: boom'],
    device: { id: 'VirtualDevice', name: 'Vega Virtual Device' }
  }))
  const list = vi.fn(async () => ({ device: 'VirtualDevice', crashes: [crash] }))
  const watch = vi.fn(() => ({ stop: vi.fn() }))
  const ovd = { crashes: { dir: () => dir, pull, detail, list, watch } } as unknown as Ovd
  const send = vi.fn()
  const win = { isDestroyed: () => false, webContents: { send } }
  const watcher = registerCrashesIpc(ovd, () => win as never)
  return { root, dir, pull, detail, list, watch, send, watcher }
}

// Like ipcMain.handle: a handler that throws rejects the invoke.
const call = async (channel: string, ...args: unknown[]): Promise<unknown> =>
  handlers.get(channel)?.({}, ...args)

beforeEach(() => {
  handlers.clear()
  writeText.mockClear()
  showItemInFolder.mockClear()
})

describe('argument validation', () => {
  test.each([
    ['a bare string', 'VirtualDevice'],
    ['no id', { device: 'VirtualDevice' }],
    ['a string id', { device: 'VirtualDevice', id: '7' }],
    ['a path from the renderer', { device: 'VirtualDevice', id: 7, path: '/etc/passwd' }],
    ['an out folder', { device: 'VirtualDevice', id: 7, out: '/tmp' }]
  ])('detail, pull, copy and reveal reject %s without calling core', async (_label, bad) => {
    const { pull, detail } = await setup()
    for (const channel of [
      channels.crashesDetail,
      channels.crashesPull,
      channels.crashesCopyPath,
      channels.crashesCopyPrompt,
      channels.crashesReveal
    ]) {
      await expect(call(channel, bad)).rejects.toThrow(TypeError)
    }
    expect(pull).not.toHaveBeenCalled()
    expect(detail).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  test('list rejects a device that isn’t a non-empty string', async () => {
    const { list } = await setup()
    await expect(call(channels.crashesList, 5)).rejects.toThrow(TypeError)
    await expect(call(channels.crashesList, '')).rejects.toThrow(TypeError)
    expect(list).not.toHaveBeenCalled()
  })
})

describe('reads', () => {
  test('list and detail pass the device and the id to core', async () => {
    const { list, detail } = await setup()
    expect(await call(channels.crashesList, 'VirtualDevice')).toMatchObject({ ok: true })
    expect(list).toHaveBeenCalledWith('VirtualDevice')
    expect(await call(channels.crashesDetail, ref)).toMatchObject({ ok: true })
    expect(detail).toHaveBeenCalledWith(7, 'VirtualDevice')
  })

  test('a core error comes back as data', async () => {
    const { detail } = await setup()
    detail.mockRejectedValueOnce(new OvdError('CRASH_NOT_FOUND', 'Gone', 'List them'))
    expect(await call(channels.crashesDetail, ref)).toEqual({
      ok: false,
      error: { code: 'CRASH_NOT_FOUND', message: 'Gone', hint: 'List them' }
    })
  })
})

describe('pull, copy and reveal', () => {
  test('pull always runs a real pull', async () => {
    const { pull } = await setup()
    await call(channels.crashesPull, ref)
    await call(channels.crashesPull, ref)
    expect(pull).toHaveBeenCalledTimes(2)
    expect(pull).toHaveBeenCalledWith({ device: 'VirtualDevice', id: 7 })
  })

  test('copy path pulls first, then reuses the record', async () => {
    const { pull, dir } = await setup()
    const first = (await call(channels.crashesCopyPath, ref)) as {
      ok: true
      data: { path: string; downloaded: boolean }
    }
    expect(first.data.downloaded).toBe(true)
    expect(first.data.path.startsWith(await realpath(dir))).toBe(true)
    expect(writeText).toHaveBeenLastCalledWith(first.data.path)
    const second = (await call(channels.crashesCopyPath, ref)) as typeof first
    expect(second.data).toEqual({ path: first.data.path, downloaded: false })
    expect(pull).toHaveBeenCalledTimes(1)
  })

  test('copy path pulls again when the downloaded file is gone', async () => {
    const { pull } = await setup()
    const first = (await call(channels.crashesCopyPath, ref)) as { data: { path: string } }
    await rm(first.data.path)
    const second = (await call(channels.crashesCopyPath, ref)) as {
      data: { downloaded: boolean }
    }
    expect(second.data.downloaded).toBe(true)
    expect(pull).toHaveBeenCalledTimes(2)
  })

  test('two copies at once share one pull', async () => {
    const { pull } = await setup()
    await Promise.all([call(channels.crashesCopyPath, ref), call(channels.crashesCopyPath, ref)])
    expect(pull).toHaveBeenCalledTimes(1)
  })

  test('copy prompt builds core’s prompt with the host path', async () => {
    await setup()
    const result = (await call(channels.crashesCopyPrompt, ref)) as { data: { path: string } }
    const text = String(writeText.mock.calls.at(-1)?.[0])
    expect(text).toContain(`Full crash report (ACR file): ${result.data.path}`)
    expect(text).toContain('Package: com.example.player')
    expect(text).toContain('Untrusted crash data from the device')
    expect(text).toContain('Error: boom')
  })

  test('copy prompt does not pull a report that is out of scope', async () => {
    const { pull, detail } = await setup()
    detail.mockRejectedValueOnce(new OvdError('CRASH_NOT_FOUND', 'Gone', 'List them'))
    const result = await call(channels.crashesCopyPrompt, ref)
    expect(result).toMatchObject({ ok: false })
    expect(pull).not.toHaveBeenCalled()
    expect(writeText).not.toHaveBeenCalled()
  })

  test('a pull error is data and copies nothing', async () => {
    const { pull } = await setup()
    pull.mockRejectedValueOnce(new OvdError('CRASH_PULL_FAILED', 'No', 'Retry'))
    expect(await call(channels.crashesCopyPath, ref)).toMatchObject({
      ok: false,
      error: { code: 'CRASH_PULL_FAILED' }
    })
    expect(writeText).not.toHaveBeenCalled()
  })

  test('a pull that returns a path outside the crashes folder is refused', async () => {
    const { pull, root } = await setup()
    const outside = join(root, 'elsewhere.acr')
    await writeFile(outside, 'x')
    pull.mockResolvedValueOnce({ crash, path: outside, bytes: 1 })
    await expect(call(channels.crashesCopyPath, ref)).rejects.toThrow(TypeError)
    expect(writeText).not.toHaveBeenCalled()
  })

  test('reveal shows only what main downloaded', async () => {
    await setup()
    expect(await call(channels.crashesReveal, ref)).toMatchObject({
      ok: false,
      error: { code: 'PATH_NOT_FOUND' }
    })
    expect(showItemInFolder).not.toHaveBeenCalled()
    const pulled = (await call(channels.crashesPull, ref)) as { data: { path: string } }
    expect(await call(channels.crashesReveal, ref)).toEqual({ ok: true, data: null })
    expect(showItemInFolder).toHaveBeenCalledWith(expect.stringContaining('.acr'))
    expect(
      String(showItemInFolder.mock.calls[0]?.[0]).endsWith(pulled.data.path.split('/').pop() ?? '')
    ).toBe(true)
  })
})

describe('the watcher', () => {
  test('pushes a new report to the window', async () => {
    const { watcher, watch, send } = await setup()
    const win = {
      isVisible: () => true,
      isMinimized: () => false,
      isDestroyed: () => false,
      on: () => undefined
    }
    watcher.watch(win)
    const opts = (watch.mock.calls[0] as unknown as [{ onNew: (c: Crash, d: object) => void }])[0]
    const device = { id: 'VirtualDevice', name: 'Vega Virtual Device' }
    opts.onNew(crash, device)
    expect(send).toHaveBeenCalledWith(channels.crashesNew, { device, crash })
  })
})
