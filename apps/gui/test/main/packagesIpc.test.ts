// @vitest-environment node
import type { Ovd } from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => handlers.set(channel, fn) },
  dialog: { showOpenDialog: vi.fn() }
}))

const { registerPackagesIpc } = await import('../../src/main/packagesIpc')
const { channels } = await import('../../src/preload/api')

const call = async (channel: string, ...args: unknown[]): Promise<unknown> =>
  handlers.get(channel)?.({}, ...args)

function setup() {
  const manifestFile = vi.fn(async (path: string) => ({ path, lines: [] }))
  const files = vi.fn(async (path: string) => ({ path, entries: [] }))
  const validate = vi.fn(async (path: string) => ({ path, valid: true }))
  const ovd = { packages: { manifestFile, files, validate } } as unknown as Ovd
  registerPackagesIpc(ovd, () => undefined)
  return { manifestFile, files, validate }
}

describe('packages IPC (Stage 5.3 tabs)', () => {
  test.each([
    ['packagesManifest', 'manifestFile'],
    ['packagesFiles', 'files'],
    ['packagesValidate', 'validate']
  ] as const)('%s calls core’s %s with the path', async (channel, method) => {
    const core = setup()
    const result = await call(channels[channel], '/home/dev/p.vpkg')
    expect(core[method]).toHaveBeenCalledWith('/home/dev/p.vpkg')
    expect(result).toMatchObject({ ok: true, data: { path: '/home/dev/p.vpkg' } })
  })

  test.each([undefined, '', 42, ['/p.vpkg']])(
    'a path that isn’t a non-empty string: %j',
    async (path) => {
      const core = setup()
      // A bad payload is a bug in the renderer, not an OVD error: the invoke rejects.
      await expect(call(channels.packagesValidate, path)).rejects.toThrow(TypeError)
      expect(core.validate).not.toHaveBeenCalled()
    }
  )
})
