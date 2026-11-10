import type { FolderProject, RestartResult, RunOutcome, VpkgSource } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import type { RunProgress } from '../../../src/preload/api'
import {
  runCli,
  runDisabledReason,
  runLabel,
  runReducer,
  runToast,
  type RunEvent,
  type RunState
} from '../../../src/renderer/src/run/runView'
import { stick, vvd, wifiOffline } from '../screens/devices/sample'

const folder: FolderProject = {
  kind: 'folder',
  path: '/home/dev/dev/hellovega',
  displayPath: '~/dev/hellovega',
  name: 'hellovega'
}
const vpkg: VpkgSource = {
  kind: 'vpkg',
  path: '/home/dev/Downloads/player_aarch64.vpkg',
  displayPath: '~/Downloads/player_aarch64.vpkg',
  file: 'player_aarch64.vpkg'
}
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
const launchBase = {
  target: { id: target.id, name: target.name },
  app: { packageId: pkg.id, title: pkg.title, componentId: 'com.example.hellovega.main' },
  wasRunning: false,
  launched: true as const
}
const verified: RestartResult = { ...launchBase, verified: true, pid: 3571 }
const crashed: RestartResult = {
  ...launchBase,
  verified: false,
  reason: 'crashed',
  crash: {
    pid: 3200,
    time: '2026-11-08T01:51:44.657Z',
    signal: 'SIGABRT',
    message: 'Error: player: deliberate crash right after launch',
    stack: [],
    logs: []
  }
}
const outcome = (launch: RestartResult): RunOutcome => ({
  target,
  package: pkg,
  forced: false,
  launch
})

const step = (s: RunProgress): RunEvent => ({ kind: 'progress', progress: s })
const steps: RunEvent[] = [
  step({ kind: 'step', step: { step: 'build', package: pkg, target } }),
  step({ kind: 'step', step: { step: 'install', package: pkg, target } }),
  step({ kind: 'step', step: { step: 'logs' } })
]
const replay = (events: RunEvent[]): RunState =>
  events.reduce(
    runReducer,
    runReducer({ phase: 'idle' }, { kind: 'start', device: 'VirtualDevice' })
  )
const statuses = (state: RunState) =>
  state.phase === 'idle' ? [] : state.rows.map((r) => `${r.id}:${r.status}`)

describe('runReducer', () => {
  test('a run starts with the build row active and the rest pending', () => {
    expect(statuses(replay([]))).toEqual([
      'build:active',
      'install:pending',
      'logs:pending',
      'launch:pending',
      'verify:pending',
      'follow:pending'
    ])
  })

  test('each step finishes the one before; build and install carry the file and target', () => {
    const state = replay(steps)
    expect(statuses(state).slice(0, 3)).toEqual(['build:done', 'install:done', 'logs:active'])
    if (state.phase === 'idle') throw new Error('expected a run')
    expect(state.rows[0]?.detail).toBe('build/aarch64-debug/hellovega_aarch64.vpkg · debug')
    expect(state.rows[1]?.detail).toBe('on Vega Virtual Device')
  })

  test('a log session with restart after install off is skipped, and stays skipped', () => {
    const state = replay([
      ...steps,
      step({ kind: 'logs', outcome: 'skipped' }),
      step({ kind: 'step', step: { step: 'launch' } })
    ])
    if (state.phase === 'idle') throw new Error('expected a run')
    expect(state.rows[2]).toMatchObject({
      status: 'skipped',
      detail: 'Restart after install is off'
    })
    expect(state.rows[3]?.status).toBe('active')
  })

  test('a verified run: every row done', () => {
    const state = replay([
      ...steps,
      { kind: 'finish', result: { ok: true, data: outcome(verified) } }
    ])
    expect(state.phase).toBe('done')
    expect(statuses(state).every((s) => s.endsWith(':done'))).toBe(true)
  })

  test('a crash: Verify launch failed with "Crashed on launch" and the cause, follow pending', () => {
    const state = replay([
      ...steps,
      step({ kind: 'step', step: { step: 'launch' } }),
      step({ kind: 'step', step: { step: 'verify' } }),
      { kind: 'finish', result: { ok: true, data: outcome(crashed) } }
    ])
    expect(state.phase).toBe('failed')
    if (state.phase === 'idle') throw new Error('expected a run')
    expect(state.rows[4]).toMatchObject({
      status: 'failed',
      detail: 'Crashed on launch · Error: player: deliberate crash right after launch'
    })
    expect(state.rows[5]?.status).toBe('pending')
    expect(state.crash?.pid).toBe(3200)
  })

  test('an error fails the active row with its message', () => {
    const error = {
      code: 'ARCH_MISMATCH' as const,
      message: 'Architecture mismatch: package is armv7, Vega Virtual Device is aarch64',
      hint: 'Build the app for aarch64'
    }
    // The guard runs inside the install, after both steps started.
    const state = replay([...steps.slice(0, 2), { kind: 'finish', result: { ok: false, error } }])
    expect(state.phase).toBe('failed')
    expect(statuses(state).slice(0, 2)).toEqual(['build:done', 'install:failed'])
  })

  test('progress without a run is ignored', () => {
    expect(runReducer({ phase: 'idle' }, steps[2] as RunEvent)).toEqual({ phase: 'idle' })
  })
})

describe('runDisabledReason', () => {
  const online = { ...vvd, status: 'online' as const }
  test.each([
    ['nothing open', null, online, false, 'Open a project or drop a .vpkg'],
    [
      'a missing project',
      { ...folder, missing: true as const },
      online,
      false,
      '~/dev/hellovega is no longer a Vega project'
    ],
    [
      'a missing .vpkg',
      { ...vpkg, missing: true as const },
      online,
      false,
      '~/Downloads/player_aarch64.vpkg doesn’t exist'
    ],
    ['no target', folder, undefined, false, 'Pick a target first'],
    ['a stopped Virtual Device', folder, vvd, false, 'Vega Virtual Device is offline'],
    ['an offline stick', folder, wifiOffline, false, 'Bedroom stick is offline'],
    ['a run in progress', folder, stick, true, 'A run is in progress'],
    ['ready', folder, stick, false, null]
  ])('%s', (_name, mode, device, running, reason) => {
    expect(runDisabledReason(mode, device, running)).toBe(reason)
  })
})

describe('labels, echo and toast', () => {
  test.each([
    [null, 'Run'],
    [folder, 'Run ▸ hellovega'],
    [vpkg, 'Run ▸ player_aarch64.vpkg']
  ])('label of %o', (mode, label) => {
    expect(runLabel(mode)).toBe(label)
  })

  test('the echo is ovd run --device <id>', () => {
    expect(runCli('VirtualDevice')).toBe('ovd run --device VirtualDevice')
  })

  test('toasts: verified, crashed, failed', () => {
    const cli = 'ovd run --device VirtualDevice'
    expect(runToast({ ok: true, data: outcome(verified) }, 'VirtualDevice')).toEqual({
      tone: 'ok',
      text: 'Running hellovega_aarch64.vpkg on Vega Virtual Device · verified',
      cli
    })
    expect(runToast({ ok: true, data: outcome(crashed) }, 'VirtualDevice')).toEqual({
      tone: 'error',
      text: 'Hello Vega: Crashed on launch',
      cli
    })
    expect(
      runToast(
        { ok: false, error: { code: 'NO_PACKAGE', message: 'No build', hint: 'Build the app' } },
        'VirtualDevice'
      )
    ).toEqual({ tone: 'error', text: 'No build. Build the app', cli })
  })
})
