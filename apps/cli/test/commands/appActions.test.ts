import type {
  LaunchResult,
  ReinstallResult,
  RestartResult,
  TerminateResult,
  UninstallResult
} from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import { cli } from '../support/runCli.js'
import { fail, stubApps } from '../support/sample.js'

const target = { id: 'VirtualDevice', name: 'Vega Virtual Device' }
const app = { packageId: 'com.example.player', title: 'Sample Player' }
const main = { ...app, componentId: 'com.example.player.main' }

const launched: LaunchResult = { target, app: main, launched: true }
const stopped: TerminateResult = { target, app, forced: false, wasRunning: true }
const restarted: RestartResult = { target, app: main, wasRunning: true, launched: true }
const uninstalled: UninstallResult = { target, app, uninstalled: true }
const reinstalled: ReinstallResult = {
  target: { ...target, architecture: 'aarch64' },
  app,
  uninstalled: true,
  package: {
    path: '/home/dev/dev/player/build/aarch64-debug/player_aarch64.vpkg',
    displayPath: '~/dev/player/build/aarch64-debug/player_aarch64.vpkg',
    file: 'player_aarch64.vpkg',
    id: 'com.example.player',
    title: 'Sample Player',
    version: '1.4.2',
    buildNumber: 142,
    architecture: 'aarch64'
  },
  forced: false
}

const VVD = ['--device', 'VirtualDevice']

describe('ovd apps launch', () => {
  test('--json prints the launch; --device reaches core', async () => {
    const launch = vi.fn(async () => launched)
    const { stdout, exitCode } = await cli(
      ['apps', 'launch', 'com.example.player', ...VVD, '--json'],
      { ovd: stubApps({ launch }) }
    )
    expect(JSON.parse(stdout)).toEqual({ ok: true, launch: launched })
    expect(exitCode).toBe(0)
    expect(launch).toHaveBeenCalledWith('com.example.player', { device: 'VirtualDevice' })
  })

  test('without an app, the open one', async () => {
    const launch = vi.fn(async () => launched)
    await cli(['apps', 'launch', '--json'], { ovd: stubApps({ launch }) })
    expect(launch).toHaveBeenCalledWith(undefined, {})
  })

  test('human output', async () => {
    const { stdout, stderr } = await cli(['apps', 'launch', 'com.example.player'], {
      ovd: stubApps({ launch: async () => launched })
    })
    expect(stdout).toBe('Launched com.example.player.main on Vega Virtual Device\n')
    expect(stderr).toBe('Launching com.example.player…\n')
  })

  test.each([
    ['APP_NOT_INSTALLED', 1],
    ['NO_APP', 2],
    ['TARGET_OFFLINE', 4],
    ['LAUNCH_FAILED', 1]
  ] as const)('%s exits %i', async (code, exit) => {
    const { stdout, exitCode } = await cli(['apps', 'launch', 'com.example.player', '--json'], {
      ovd: stubApps({ launch: fail(code) })
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code } })
    expect(exitCode).toBe(exit)
  })
})

describe('ovd apps terminate', () => {
  test('--json prints the stop; --force and --device reach core', async () => {
    const terminate = vi.fn(async () => ({ ...stopped, forced: true, wasRunning: null }))
    const { stdout, exitCode } = await cli(
      ['apps', 'terminate', 'com.example.player', '--force', ...VVD, '--json'],
      { ovd: stubApps({ terminate }) }
    )
    expect(JSON.parse(stdout)).toEqual({
      ok: true,
      terminate: { ...stopped, forced: true, wasRunning: null }
    })
    expect(exitCode).toBe(0)
    expect(terminate).toHaveBeenCalledWith('com.example.player', {
      device: 'VirtualDevice',
      force: true
    })
  })

  test.each([
    [stopped, 'Stopped com.example.player on Vega Virtual Device\n'],
    [
      { ...stopped, wasRunning: false },
      'com.example.player wasn’t running on Vega Virtual Device\n'
    ],
    [
      { ...stopped, forced: true, wasRunning: null },
      'Force stopped com.example.player on Vega Virtual Device\n'
    ]
  ])('human output %#', async (result, line) => {
    const { stdout, exitCode } = await cli(['apps', 'terminate'], {
      ovd: stubApps({ terminate: async () => result })
    })
    expect(stdout).toBe(line)
    expect(exitCode).toBe(0)
  })

  test.each([
    ['TERMINATE_FAILED', 1],
    ['TARGET_OFFLINE', 4]
  ] as const)('%s exits %i', async (code, exit) => {
    const { exitCode } = await cli(['apps', 'terminate', '--json'], {
      ovd: stubApps({ terminate: fail(code) })
    })
    expect(exitCode).toBe(exit)
  })
})

describe('ovd apps restart', () => {
  test('--json prints the restart', async () => {
    const restart = vi.fn(async () => restarted)
    const { stdout, exitCode } = await cli(['apps', 'restart', ...VVD, '--json'], {
      ovd: stubApps({ restart })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, restart: restarted })
    expect(exitCode).toBe(0)
    expect(restart).toHaveBeenCalledWith(undefined, { device: 'VirtualDevice' })
  })

  test.each([
    [restarted, 'Restarted com.example.player.main on Vega Virtual Device\n'],
    [
      { ...restarted, wasRunning: false },
      'Started com.example.player.main on Vega Virtual Device (it wasn’t running)\n'
    ]
  ])('human output %#', async (result, line) => {
    const { stdout } = await cli(['apps', 'restart'], {
      ovd: stubApps({ restart: async () => result })
    })
    expect(stdout).toBe(line)
  })

  test('APP_NOT_INSTALLED exits 1', async () => {
    const { exitCode } = await cli(['apps', 'restart', '--json'], {
      ovd: stubApps({ restart: fail('APP_NOT_INSTALLED') })
    })
    expect(exitCode).toBe(1)
  })
})

describe('ovd apps uninstall', () => {
  test('--json prints the uninstall', async () => {
    const uninstall = vi.fn(async () => uninstalled)
    const { stdout, exitCode } = await cli(
      ['apps', 'uninstall', 'com.example.player', ...VVD, '--json'],
      { ovd: stubApps({ uninstall }) }
    )
    expect(JSON.parse(stdout)).toEqual({ ok: true, uninstall: uninstalled })
    expect(exitCode).toBe(0)
    expect(uninstall).toHaveBeenCalledWith('com.example.player', { device: 'VirtualDevice' })
  })

  test('human output', async () => {
    const { stdout } = await cli(['apps', 'uninstall', 'com.example.player'], {
      ovd: stubApps({ uninstall: async () => uninstalled })
    })
    expect(stdout).toBe('Uninstalled com.example.player from Vega Virtual Device\n')
  })

  test.each([
    ['NOT_SIDELOADED', 1],
    ['UNINSTALL_FAILED', 1],
    ['APP_NOT_INSTALLED', 1]
  ] as const)('%s exits %i', async (code, exit) => {
    const { exitCode } = await cli(['apps', 'uninstall', 'com.example.player', '--json'], {
      ovd: stubApps({ uninstall: fail(code) })
    })
    expect(exitCode).toBe(exit)
  })
})

describe('ovd apps reinstall', () => {
  test('--json prints the reinstall; --force and --device reach core', async () => {
    const reinstall = vi.fn(async () => reinstalled)
    const { stdout, exitCode } = await cli(
      ['apps', 'reinstall', '~/dev/player', '--force', ...VVD, '--json'],
      { ovd: stubApps({ reinstall }) }
    )
    expect(JSON.parse(stdout)).toEqual({ ok: true, reinstall: reinstalled })
    expect(exitCode).toBe(0)
    expect(reinstall).toHaveBeenCalledWith('~/dev/player', { device: 'VirtualDevice', force: true })
  })

  test('human output, with the warning of a forced install', async () => {
    const { stdout, stderr } = await cli(['apps', 'reinstall'], {
      ovd: stubApps({ reinstall: async () => ({ ...reinstalled, forced: true }) })
    })
    expect(stdout).toBe(
      'Reinstalled player_aarch64.vpkg (com.example.player 1.4.2) on Vega Virtual Device · aarch64\n'
    )
    expect(stderr).toContain('installed despite the architecture mismatch (--force)')
  })

  test.each([
    ['ARCH_MISMATCH', 6],
    ['NO_PACKAGE', 2],
    ['NOT_SIDELOADED', 1],
    ['TARGET_OFFLINE', 4]
  ] as const)('%s exits %i', async (code, exit) => {
    const { exitCode } = await cli(['apps', 'reinstall', '--json'], {
      ovd: stubApps({ reinstall: fail(code) })
    })
    expect(exitCode).toBe(exit)
  })
})

describe('an app ID that isn’t one', () => {
  test.each(['launch', 'terminate', 'restart', 'uninstall', 'reinstall'] as const)(
    'ovd apps %s prints INVALID_APP_ID and exits 2',
    async (action) => {
      const { stdout, exitCode } = await cli(['apps', action, 'x;rm -rf ~', '--json'], {
        ovd: stubApps({ [action]: fail('INVALID_APP_ID') })
      })
      expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'INVALID_APP_ID' } })
      expect(exitCode).toBe(2)
    }
  )
})
