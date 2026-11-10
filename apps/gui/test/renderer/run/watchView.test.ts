import type {
  Device,
  FolderProject,
  PackageBuild,
  ProjectMode,
  RestartResult,
  RunOutcome,
  VpkgSource
} from '@ovd/core'
import { describe, expect, test } from 'vitest'
import type { IpcResult } from '../../../src/preload/api'
import {
  changedToast,
  redeployedToast,
  watchCli,
  watchDisabledReason,
  watchLabel,
  watchOnToast,
  watchVisible
} from '../../../src/renderer/src/run/watchView'
import { stick, vvd, wifiOffline } from '../screens/devices/sample'

const folder: FolderProject = {
  kind: 'folder',
  path: '/home/dev/dev/player',
  displayPath: '~/dev/player',
  name: 'player'
}
const vpkg: VpkgSource = {
  kind: 'vpkg',
  path: '/home/dev/Downloads/player_aarch64.vpkg',
  displayPath: '~/Downloads/player_aarch64.vpkg',
  file: 'player_aarch64.vpkg'
}
const online: Device = { ...vvd, status: 'online', vdaSerial: 'emulator-5554' }
const target = { id: 'VirtualDevice', name: 'Vega Virtual Device', architecture: 'aarch64' }
const build: PackageBuild = {
  path: '/home/dev/dev/player/build/aarch64-debug/player_aarch64.vpkg',
  displayPath: '~/dev/player/build/aarch64-debug/player_aarch64.vpkg',
  file: 'player_aarch64.vpkg',
  folder: 'build/aarch64-debug/',
  size: 1_000,
  modifiedAt: '2026-11-10T09:05:00.000Z',
  folderArch: 'aarch64',
  folderBuildType: 'debug'
}
const pkg = {
  path: build.path,
  displayPath: build.displayPath,
  file: build.file,
  id: 'com.example.player',
  title: 'Sample Player',
  version: '1.4.2',
  buildNumber: 142,
  architecture: 'aarch64' as const,
  buildType: 'debug' as const
}
const launchBase = {
  target: { id: target.id, name: target.name },
  app: { packageId: pkg.id, title: pkg.title, componentId: 'com.example.player.main' },
  wasRunning: true,
  launched: true as const
}
const verified: RestartResult = { ...launchBase, verified: true, pid: 3571 }
const notRunning: RestartResult = { ...launchBase, verified: false, reason: 'not-running' }
const ran = (launch: RestartResult): IpcResult<RunOutcome> => ({
  ok: true,
  data: { target, package: pkg, forced: false, launch }
})
const CLI = 'ovd run --watch --device VirtualDevice'

describe('watch labels and visibility', () => {
  test.each([
    [true, 'Watching build/'],
    [false, 'Watch off']
  ])('watching=%s: %s', (watching, label) => {
    expect(watchLabel(watching)).toBe(label)
  })

  test.each<[string, ProjectMode | null, boolean]>([
    ['a project folder', folder, true],
    ['a .vpkg', vpkg, false],
    ['nothing open', null, false],
    ['a folder that is gone', { ...folder, missing: true }, false]
  ])('%s: shown=%s', (_name, mode, shown) => {
    expect(watchVisible(mode)).toBe(shown)
  })
})

describe('watchDisabledReason', () => {
  test.each<[string, Device | undefined, boolean, string | null]>([
    ['no target', undefined, false, 'Pick a target first'],
    ['a stopped Virtual Device', vvd, false, 'Vega Virtual Device is offline'],
    ['an offline stick', wifiOffline, false, `${wifiOffline.name} is offline`],
    ['an online target', online, false, null],
    ['an online stick', stick, false, null],
    ['watching, the target offline: it can still be turned off', vvd, true, null],
    ['watching, no target', undefined, true, null]
  ])('%s', (_name, device, watching, reason) => {
    expect(watchDisabledReason(device, watching)).toBe(reason)
  })
})

describe('watch toasts', () => {
  test('on: the CLI equivalent', () => {
    expect(watchCli('VirtualDevice')).toBe(CLI)
    expect(watchOnToast('VirtualDevice')).toEqual({
      tone: 'info',
      text: 'Watching build/ for new builds',
      cli: CLI
    })
  })

  test('a batch with a build toasts nothing: its run shows the steps', () => {
    expect(
      changedToast({ folder: '~/dev/player', changed: [build], build, target }, 'VirtualDevice')
    ).toBeNull()
  })

  test('a batch with no build for the target', () => {
    expect(
      changedToast({ folder: '~/dev/player', changed: [build], target }, 'VirtualDevice')
    ).toEqual({
      tone: 'info',
      text: 'Build folder changed · no build for Vega Virtual Device',
      cli: CLI
    })
  })

  test('a batch while the target is offline: the TARGET_OFFLINE text', () => {
    expect(
      changedToast(
        {
          folder: '~/dev/player',
          changed: [build],
          error: {
            code: 'TARGET_OFFLINE',
            message: 'Vega Virtual Device is stopped',
            hint: 'Start it with ovd vvd start'
          }
        },
        'VirtualDevice'
      )
    ).toEqual({
      tone: 'error',
      text: 'Vega Virtual Device is stopped. Start it with ovd vvd start',
      cli: CLI
    })
  })

  test.each<[string, IpcResult<RunOutcome>, { tone: string; text: string }]>([
    [
      'verified',
      ran(verified),
      { tone: 'ok', text: 'Redeployed player_aarch64.vpkg on Vega Virtual Device · verified' }
    ],
    [
      'not running',
      ran(notRunning),
      { tone: 'error', text: 'Sample Player: Not running after launch' }
    ],
    [
      'an error',
      {
        ok: false,
        error: { code: 'INSTALL_FAILED', message: 'Install failed: disk full', hint: 'Retry' }
      },
      { tone: 'error', text: 'Install failed: disk full. Retry' }
    ]
  ])('redeployed: %s', (_name, result, toast) => {
    expect(redeployedToast(result, 'VirtualDevice')).toEqual({ ...toast, cli: CLI })
  })
})
