// @vitest-environment node
import {
  OvdError,
  type BuildChange,
  type PackageBuild,
  type RunOutcome,
  type WatchEnd,
  type WatchOptions
} from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import { createWatchController } from '../../src/main/watchController'
import type { IpcResult, LogsState, WatchEvent } from '../../src/preload/api'

const FOLDER = '/home/dev/dev/player'
const target = { id: 'VirtualDevice', name: 'Vega Virtual Device', architecture: 'aarch64' }
const build: PackageBuild = {
  path: `${FOLDER}/build/aarch64-debug/player_aarch64.vpkg`,
  displayPath: '~/dev/player/build/aarch64-debug/player_aarch64.vpkg',
  file: 'player_aarch64.vpkg',
  folder: 'build/aarch64-debug/',
  size: 1_000,
  modifiedAt: '2026-11-10T09:05:00.000Z',
  folderArch: 'aarch64',
  folderBuildType: 'debug'
}
const outcome = { target } as unknown as RunOutcome
const folder = { path: FOLDER, displayPath: '~/dev/player' }

function setup(
  opts: {
    startError?: OvdError
    logsRunningFor?: string | null
    target?: string | null
    redeploy?: () => Promise<IpcResult<RunOutcome>>
  } = {}
) {
  const sent: WatchEvent[] = []
  let onBuild: WatchOptions['onBuild'] | undefined
  let end: (why: WatchEnd) => void = () => undefined
  const stop = vi.fn(() => end({ reason: 'stopped' }))
  const start = vi.fn(async (_ref: string | undefined, watch: WatchOptions) => {
    if (opts.startError) throw opts.startError
    onBuild = watch.onBuild
    return {
      ...folder,
      stop,
      done: new Promise<WatchEnd>((resolve) => (end = resolve))
    }
  })
  const redeploy = vi.fn(
    opts.redeploy ?? (async (): Promise<IpcResult<RunOutcome>> => ({ ok: true, data: outcome }))
  )
  const running = opts.logsRunningFor ?? null
  const open = vi.fn(async (device: string): Promise<LogsState> => ({
    status: 'starting',
    device,
    name: device,
    restartAfterInstall: true
  }))
  const controller = createWatchController({
    watch: { start },
    redeploy,
    logs: { open, running: () => running !== null, device: () => running },
    target: async () => (opts.target === undefined ? 'VirtualDevice' : opts.target),
    send: (e) => sent.push(e)
  })
  return {
    controller,
    sent,
    start,
    stop,
    redeploy,
    open,
    build: async (change: BuildChange) => {
      if (!onBuild) throw new Error('not watching')
      await onBuild(change)
    },
    end: (why: WatchEnd) => end(why)
  }
}

describe('createWatchController', () => {
  test('on: watches the open project, pushes the state and opens a session for the target', async () => {
    const s = setup()
    expect(await s.controller.set(true)).toEqual({
      ok: true,
      data: { watching: true, folder: '~/dev/player' }
    })
    expect(s.start.mock.calls[0]?.[0]).toBeUndefined()
    expect(s.sent).toEqual([{ kind: 'state', watching: true, folder: '~/dev/player' }])
    expect(s.open).toHaveBeenCalledWith('VirtualDevice')
    expect(s.controller.state()).toEqual({ watching: true, folder: '~/dev/player' })
  })

  test('a session already following the target is reused', async () => {
    const s = setup({ logsRunningFor: 'VirtualDevice' })
    await s.controller.set(true)
    expect(s.open).not.toHaveBeenCalled()
  })

  test('on while on, or twice at once, starts one watch', async () => {
    const s = setup()
    const [a, b] = await Promise.all([s.controller.set(true), s.controller.set(true)])
    expect(a).toEqual(b)
    await s.controller.set(true)
    expect(s.start).toHaveBeenCalledTimes(1)
  })

  test('NOT_A_PROJECT comes back as data and stays off', async () => {
    const s = setup({
      startError: new OvdError(
        'NOT_A_PROJECT',
        'ovd run --watch needs a project folder',
        'Pass a project folder or open one with ovd open <folder>'
      )
    })
    expect(await s.controller.set(true)).toEqual({
      ok: false,
      error: {
        code: 'NOT_A_PROJECT',
        message: 'ovd run --watch needs a project folder',
        hint: 'Pass a project folder or open one with ovd open <folder>'
      }
    })
    expect(s.controller.state()).toEqual({ watching: false })
    expect(s.sent).toEqual([])
  })

  test('off stops the watch and pushes the state', async () => {
    const s = setup()
    await s.controller.set(true)
    expect(await s.controller.set(false)).toEqual({ ok: true, data: { watching: false } })
    expect(s.stop).toHaveBeenCalled()
    expect(s.sent.at(-1)).toEqual({ kind: 'state', watching: false })
  })

  test('refuses an `on` that isn’t a boolean', async () => {
    const s = setup()
    await expect(s.controller.set('yes')).rejects.toThrow(TypeError)
  })

  test('a batch with a build: changed, then the redeploy on the target, then its result', async () => {
    const s = setup()
    await s.controller.set(true)
    await s.build({ folder, changed: [build], build, target })
    expect(s.redeploy).toHaveBeenCalledWith('VirtualDevice', build.path)
    expect(s.sent.slice(1)).toEqual([
      {
        kind: 'changed',
        change: { folder: '~/dev/player', changed: [build], build, target }
      },
      { kind: 'redeployed', device: 'VirtualDevice', result: { ok: true, data: outcome } }
    ])
  })

  test('a batch with no build or a target error: changed only, the error as data', async () => {
    const s = setup()
    await s.controller.set(true)
    await s.build({
      folder,
      changed: [build],
      error: new OvdError('TARGET_OFFLINE', 'Vega Virtual Device is stopped', 'hint')
    })
    await s.build({ folder, changed: [build], target })
    expect(s.redeploy).not.toHaveBeenCalled()
    expect(s.sent.slice(1)).toEqual([
      {
        kind: 'changed',
        change: {
          folder: '~/dev/player',
          changed: [build],
          error: { code: 'TARGET_OFFLINE', message: 'Vega Virtual Device is stopped', hint: 'hint' }
        }
      },
      { kind: 'changed', change: { folder: '~/dev/player', changed: [build], target } }
    ])
  })

  test('a redeploy that throws is a failed result, not a crash', async () => {
    const s = setup({
      redeploy: async () => {
        throw new Error('boom')
      }
    })
    await s.controller.set(true)
    await s.build({ folder, changed: [build], build, target })
    expect(s.sent.at(-1)).toMatchObject({
      kind: 'redeployed',
      result: { ok: false, error: { code: 'COMMAND_FAILED', message: 'boom' } }
    })
  })

  test('another project opened: the watch ends, main pushes stopped and the state', async () => {
    const s = setup()
    await s.controller.set(true)
    s.end({ reason: 'project-changed' })
    await vi.waitFor(() => expect(s.controller.state()).toEqual({ watching: false }))
    expect(s.sent.slice(1)).toEqual([{ kind: 'state', watching: false }, { kind: 'stopped' }])
  })

  test('stop (quit, window closed) stops the watch', async () => {
    const s = setup()
    await s.controller.set(true)
    s.controller.stop()
    expect(s.stop).toHaveBeenCalled()
    expect(s.controller.state()).toEqual({ watching: false })
  })
})
