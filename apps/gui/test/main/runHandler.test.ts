// @vitest-environment node
import { OvdError, type Ovd, type RunOptions, type RunOutcome } from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import { createRunHandler } from '../../src/main/runHandler'
import type { RunProgress } from '../../src/preload/api'

const target = { id: 'VirtualDevice', name: 'Vega Virtual Device', architecture: 'aarch64' }
const pkg = {
  path: '/home/dev/dev/hellovega/build/aarch64-debug/hellovega_aarch64.vpkg',
  displayPath: '~/dev/hellovega/build/aarch64-debug/hellovega_aarch64.vpkg',
  file: 'hellovega_aarch64.vpkg',
  id: 'com.example.hellovega',
  title: 'Hello Vega',
  version: '0.1.0',
  buildNumber: 1,
  architecture: 'any' as const,
  buildType: 'debug' as const,
  folder: 'build/aarch64-debug/'
}
const outcome: RunOutcome = {
  target,
  package: pkg,
  forced: false,
  launch: {
    target: { id: target.id, name: target.name },
    app: {
      packageId: pkg.id,
      title: pkg.title,
      componentId: 'com.example.hellovega.main'
    },
    wasRunning: false,
    launched: true,
    verified: true,
    pid: 3571
  }
}

function setup(run: (ref: string | undefined, opts: RunOptions) => Promise<RunOutcome>) {
  const sent: RunProgress[] = []
  const order: string[] = []
  const cancel = vi.fn(() => order.push('cancel'))
  const arm = { restarted: Promise.resolve(), cancel }
  const armRestart = vi.fn(() => {
    order.push('arm')
    return arm
  })
  const follow = vi.fn(async () => {
    order.push('follow')
    return 'restarted' as const
  })
  const runFn = vi.fn(async (ref: string | undefined, opts: RunOptions) => {
    order.push('run')
    return run(ref, opts)
  })
  const handler = createRunHandler({
    run: { run: runFn } as unknown as Ovd['run'],
    logs: { armRestart, follow },
    send: (p) => sent.push(p)
  })
  const handle = (device: unknown) => handler.run(device)
  return { handle, handler, sent, order, armRestart, follow, runFn, arm }
}

describe('createRunHandler', () => {
  test('runs with no ref on the device, arms the restart first, pushes every step', async () => {
    const s = setup(async (_ref, opts) => {
      opts.onStep?.({ step: 'build', package: pkg, target })
      opts.onStep?.({ step: 'logs' })
      await opts.followLogs(target, pkg.id)
      opts.onStep?.({ step: 'launch' })
      return outcome
    })

    const result = await s.handle('VirtualDevice')

    expect(result).toEqual({ ok: true, data: outcome })
    expect(s.runFn.mock.calls[0]?.[0]).toBeUndefined()
    expect(s.runFn.mock.calls[0]?.[1]).toMatchObject({ device: 'VirtualDevice' })
    expect(s.follow).toHaveBeenCalledWith('VirtualDevice', s.arm)
    expect(s.order).toEqual(['arm', 'run', 'follow', 'cancel'])
    expect(s.sent).toEqual([
      { kind: 'step', step: { step: 'build', package: pkg, target } },
      { kind: 'step', step: { step: 'logs' } },
      { kind: 'logs', outcome: 'restarted' },
      { kind: 'step', step: { step: 'launch' } }
    ])
  })

  test('a core error comes back as data, and the wait is dropped', async () => {
    const s = setup(async () => {
      throw new OvdError('ARCH_MISMATCH', 'Architecture mismatch', 'hint')
    })

    expect(await s.handle('VirtualDevice')).toEqual({
      ok: false,
      error: { code: 'ARCH_MISMATCH', message: 'Architecture mismatch', hint: 'hint' }
    })
    expect(s.arm.cancel).toHaveBeenCalled()
  })

  test('one run at a time; the next one runs once it is done', async () => {
    let finish: () => void = () => undefined
    const s = setup(
      () =>
        new Promise<RunOutcome>((resolve) => {
          finish = () => resolve(outcome)
        })
    )
    const first = s.handle('VirtualDevice')

    await expect(s.handle('VirtualDevice')).rejects.toThrow('a run is already in progress')
    finish()
    await first
    finish = () => undefined
    const again = s.handle('VirtualDevice')
    await vi.waitFor(() => expect(s.runFn).toHaveBeenCalledTimes(2))
    finish()
    expect(s.runFn).toHaveBeenCalledTimes(2)
    void again
  })

  test('refuses a device that isn’t a non-empty string', async () => {
    const s = setup(async () => outcome)
    await expect(s.handle('')).rejects.toThrow(TypeError)
    await expect(s.handle(42)).rejects.toThrow(TypeError)
    expect(s.runFn).not.toHaveBeenCalled()
  })

  test('a redeploy runs the build on the device, through the same log step', async () => {
    const s = setup(async (_ref, opts) => {
      await opts.followLogs(target, pkg.id)
      return outcome
    })

    expect(await s.handler.redeploy('VirtualDevice', pkg.path)).toEqual({ ok: true, data: outcome })
    expect(s.runFn.mock.calls[0]?.[0]).toBe(pkg.path)
    expect(s.runFn.mock.calls[0]?.[1]).toMatchObject({ device: 'VirtualDevice' })
    expect(s.order).toEqual(['arm', 'run', 'follow', 'cancel'])
  })

  test('a redeploy waits for a run in flight; a run is refused while a redeploy goes', async () => {
    const finishers: Array<() => void> = []
    let active = 0
    let most = 0
    const s = setup(async () => {
      active++
      most = Math.max(most, active)
      await new Promise<void>((resolve) => finishers.push(resolve))
      active--
      return outcome
    })
    const first = s.handle('VirtualDevice')
    await vi.waitFor(() => expect(s.runFn).toHaveBeenCalledTimes(1))
    const redeploy = s.handler.redeploy('VirtualDevice', pkg.path)
    await new Promise((resolve) => setImmediate(resolve))
    expect(s.runFn).toHaveBeenCalledTimes(1)

    finishers.shift()?.()
    await first
    await vi.waitFor(() => expect(s.runFn).toHaveBeenCalledTimes(2))
    await expect(s.handle('VirtualDevice')).rejects.toThrow('a run is already in progress')
    finishers.shift()?.()
    expect(await redeploy).toEqual({ ok: true, data: outcome })
    expect(most).toBe(1)
  })
})
