import { OvdError, type ScreenshotOptions, type ScreenshotResult } from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import { cli } from '../support/runCli.js'
import { fail, stubScreenshot } from '../support/sample.js'

const shot: ScreenshotResult = {
  target: { id: 'VirtualDevice', name: 'Vega Virtual Device' },
  backend: 'grpc',
  path: '/home/developer/ovd/captures/vega-virtual-device-20261112-021100.png',
  width: 1920,
  height: 1080,
  bytes: 9780,
  takenAt: '2026-11-12T02:11:00.000Z'
}

describe('ovd screenshot', () => {
  test('--json prints the screenshot; nothing copied without --clipboard', async () => {
    const take = vi.fn(async () => shot)
    const copy = vi.fn()
    const { stdout, exitCode } = await cli(['screenshot', '--json'], {
      ovd: stubScreenshot({ take, copy })
    })
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ ok: true, screenshot: { ...shot, copied: false } })
    expect(take).toHaveBeenCalledWith({ force: false, signal: expect.any(AbortSignal) })
    expect(copy).not.toHaveBeenCalled()
  })

  test('--out, --force and --device reach core', async () => {
    const take = vi.fn(async () => shot)
    await cli(['screenshot', '--out', 'shot.png', '--force', '--device', 'VirtualDevice'], {
      ovd: stubScreenshot({ take })
    })
    expect(take).toHaveBeenCalledWith({
      device: 'VirtualDevice',
      out: 'shot.png',
      force: true,
      signal: expect.any(AbortSignal)
    })
  })

  test('--clipboard copies the saved file', async () => {
    const copy = vi.fn(async () => ({ tool: 'osascript' as const }))
    const { stdout, exitCode } = await cli(['screenshot', '--clipboard', '--json'], {
      ovd: stubScreenshot({ take: async () => shot, copy })
    })
    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual({ ok: true, screenshot: { ...shot, copied: true } })
    expect(copy).toHaveBeenCalledWith(shot.path)
  })

  test('human output', async () => {
    const { stdout } = await cli(['screenshot', '--clipboard'], {
      ovd: stubScreenshot({ take: async () => shot, copy: async () => ({ tool: 'xclip' }) })
    })
    expect(stdout).toBe(
      `Saved ${shot.path} (1920×1080) from Vega Virtual Device (grpc) · copied to the clipboard\n`
    )
  })

  test('a failed copy exits 1, says where the file was saved, and keeps the result', async () => {
    const { stdout, exitCode } = await cli(['screenshot', '--clipboard', '--json'], {
      ovd: stubScreenshot({
        take: async () => shot,
        copy: () =>
          Promise.reject(
            new OvdError(
              'CLIPBOARD_UNAVAILABLE',
              'No clipboard tool for this session',
              'Install xclip'
            )
          )
      })
    })
    expect(exitCode).toBe(1)
    expect(JSON.parse(stdout)).toEqual({
      ok: false,
      error: {
        code: 'CLIPBOARD_UNAVAILABLE',
        message: `Saved ${shot.path}, but couldn’t copy it to the clipboard: No clipboard tool for this session`,
        hint: 'Install xclip'
      },
      screenshot: { ...shot, copied: false }
    })
  })

  test.each([
    ['SCREENSHOT_FAILED', 1],
    ['CLIPBOARD_UNAVAILABLE', 1],
    ['VVD_GRPC_FAILED', 1],
    ['INVALID_PATH', 2],
    ['PATH_NOT_FOUND', 2],
    ['EXPORT_FILE_EXISTS', 2],
    ['TARGET_OFFLINE', 4],
    ['NO_TARGET', 4],
    ['DEVICE_NOT_FOUND', 4],
    ['SDK_NOT_FOUND', 3]
  ] as const)('%s exits %i with the error document', async (code, exit) => {
    const { stdout, exitCode } = await cli(['screenshot', '--json'], {
      ovd: stubScreenshot({ take: fail(code) })
    })
    expect(exitCode).toBe(exit)
    expect(JSON.parse(stdout)).toEqual({
      ok: false,
      error: { code, message: `failed: ${code}`, hint: `hint for ${code}` }
    })
  })

  test('Ctrl+C aborts core and reports Cancelled', async () => {
    let interrupt = (): void => undefined
    const take = vi.fn(
      (opts?: ScreenshotOptions) =>
        new Promise<ScreenshotResult>((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          )
        })
    )
    const run = cli(['screenshot', '--json'], {
      ovd: stubScreenshot({ take }),
      onInterrupt: (abort) => (interrupt = abort)
    })
    await vi.waitFor(() => expect(take).toHaveBeenCalled())
    interrupt()
    const { stdout, exitCode } = await run
    expect(exitCode).toBe(1)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { message: 'Cancelled' } })
  })
})
