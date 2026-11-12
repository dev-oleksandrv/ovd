// @vitest-environment node
import { OvdError, type RebootOptions, type RebootResult } from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import { createRebootHandler } from '../../src/main/rebootHandler'

const result: RebootResult = {
  target: { id: 'VirtualDevice', name: 'Vega Virtual Device' },
  seconds: 16,
  reconnected: false
}

function setup(reboot: (opts?: RebootOptions) => Promise<RebootResult> = async () => result) {
  const order: string[] = []
  const controller = new AbortController()
  const core = vi.fn(async (opts?: RebootOptions) => {
    order.push('reboot')
    return reboot(opts)
  })
  const handler = createRebootHandler({
    reboot: { reboot: core },
    input: {
      deviceRebooting: async (id) => void order.push(`input.rebooting ${id}`),
      deviceBack: (id) => void order.push(`input.back ${id}`)
    },
    screen: { deviceBack: (id) => void order.push(`screen.back ${id}`) },
    refresh: async () => void order.push('refresh'),
    signal: controller.signal
  })
  return { handler, core, order, controller }
}

describe('reboot handler', () => {
  test('closes the session, reboots, then reopens the session and the view and refreshes', async () => {
    const { handler, core, order, controller } = setup()
    await expect(handler('VirtualDevice')).resolves.toEqual({ ok: true, data: result })
    expect(core).toHaveBeenCalledWith({ device: 'VirtualDevice', signal: controller.signal })
    expect(order).toEqual([
      'input.rebooting VirtualDevice',
      'reboot',
      'input.back VirtualDevice',
      'screen.back VirtualDevice',
      'refresh'
    ])
  })

  test('a failed reboot is an IPC error result; the hooks still run', async () => {
    const { handler, order } = setup(() =>
      Promise.reject(new OvdError('REBOOT_TIMEOUT', 'didn’t come back', 'Restart it'))
    )
    await expect(handler('VirtualDevice')).resolves.toEqual({
      ok: false,
      error: { code: 'REBOOT_TIMEOUT', message: 'didn’t come back', hint: 'Restart it' }
    })
    expect(order.slice(-3)).toEqual([
      'input.back VirtualDevice',
      'screen.back VirtualDevice',
      'refresh'
    ])
  })

  test('quit aborts the wait', async () => {
    const { handler, controller, order } = setup(
      (opts) =>
        new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        })
    )
    const pending = handler('VirtualDevice')
    await vi.waitFor(() => expect(order).toContain('reboot'))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(order.at(-1)).toBe('refresh')
  })

  test.each([undefined, '', 42])('an id of %j is refused before anything runs', async (id) => {
    const { handler, core, order } = setup()
    await expect(handler(id)).rejects.toThrow(TypeError)
    expect(core).not.toHaveBeenCalled()
    expect(order).toEqual([])
  })
})
