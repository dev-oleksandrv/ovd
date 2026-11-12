// @vitest-environment node
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OvdError, type CapturesList, type Ovd, type ScreenshotResult } from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import { createScreenshotController } from '../../src/main/screenshotController'

const shot: ScreenshotResult = {
  target: { id: 'VirtualDevice', name: 'Vega Virtual Device' },
  backend: 'grpc',
  path: '/home/developer/ovd/captures/vega-virtual-device-20261112-021100.png',
  width: 1920,
  height: 1080,
  bytes: 9780,
  takenAt: '2026-11-12T02:11:00.000Z'
}
const list: CapturesList = {
  dir: '/home/developer/ovd/captures',
  captures: [
    {
      name: 'vega-virtual-device-20261112-021100.png',
      path: shot.path,
      bytes: 9780,
      width: 1920,
      height: 1080,
      takenAt: shot.takenAt
    }
  ]
}

function setup(opts: {
  take?: Ovd['screenshot']['take']
  copy?: (path: string) => Promise<boolean>
  dir?: string
}) {
  const sent: CapturesList[] = []
  const take = vi.fn(opts.take ?? (async () => shot))
  const copyImage = vi.fn(opts.copy ?? (async () => true))
  const controller = createScreenshotController({
    screenshot: {
      take,
      captures: async () => list,
      dir: () => opts.dir ?? list.dir,
      copy: () => Promise.reject(new Error('main copies with Electron'))
    },
    copyImage,
    send: (l) => sent.push(l)
  })
  return { controller, sent, take, copyImage }
}

describe('screenshot controller', () => {
  test('take saves, copies the file and pushes the list', async () => {
    const { controller, sent, take, copyImage } = setup({})
    expect(await controller.take('VirtualDevice')).toEqual({
      ok: true,
      data: { ...shot, copied: true }
    })
    expect(take).toHaveBeenCalledWith({ device: 'VirtualDevice' })
    expect(copyImage).toHaveBeenCalledWith(shot.path)
    expect(sent).toEqual([list])
  })

  test('a copy that fails still reports the saved file, not copied', async () => {
    const { controller } = setup({ copy: () => Promise.reject(new Error('no clipboard')) })
    expect(await controller.take('VirtualDevice')).toEqual({
      ok: true,
      data: { ...shot, copied: false }
    })
  })

  test('a core error is data, and nothing is copied or pushed', async () => {
    const { controller, sent, copyImage } = setup({
      take: () =>
        Promise.reject(
          new OvdError('TARGET_OFFLINE', 'Living room stick is offline', 'Reconnect it')
        )
    })
    expect(await controller.take('G070000000000001')).toEqual({
      ok: false,
      error: {
        code: 'TARGET_OFFLINE',
        message: 'Living room stick is offline',
        hint: 'Reconnect it'
      }
    })
    expect(copyImage).not.toHaveBeenCalled()
    expect(sent).toEqual([])
  })

  test('take refuses a device that isn’t a string', async () => {
    const { controller, take } = setup({})
    await expect(controller.take(42)).rejects.toThrow(TypeError)
    expect(take).not.toHaveBeenCalled()
  })

  test('captures lists the folder', async () => {
    expect(await setup({}).controller.captures()).toEqual({ ok: true, data: list })
  })

  test('folder creates the captures folder', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'ovd-folder-')), 'ovd', 'captures')
    expect(await setup({ dir }).controller.folder()).toBe(dir)
  })
})
