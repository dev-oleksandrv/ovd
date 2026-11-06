import type { AppDetails, AppList, InstalledApp } from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import { cli } from '../support/runCli.js'
import { fail, stubApps, stubInstall } from '../support/sample.js'

const target = { id: 'VirtualDevice', name: 'Vega Virtual Device' }

const main = {
  id: 'com.example.player.main',
  running: {
    pid: 2108,
    state: 'VISIBLE',
    lifespan: 'PERMANENT',
    container: 'framework.slice/essential/2108'
  }
}

const player: InstalledApp = {
  packageId: 'com.example.player',
  title: 'Sample Player',
  version: '1.4.2',
  buildNumber: 142,
  installedAt: '2026-11-05T23:01:46.000Z',
  updatedAt: '2026-11-05T23:01:46.000Z',
  source: 'sideloaded',
  components: [main],
  status: { state: 'running', pid: 2108, lifespan: 'PERMANENT' }
}
const list: AppList = { target, apps: [player] }

describe('ovd apps', () => {
  test('--json prints the target and its apps', async () => {
    const appsList = vi.fn(async () => list)
    const { stdout, exitCode } = await cli(['apps', '--json'], {
      ovd: stubApps({ list: appsList })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, target, apps: [player] })
    expect(exitCode).toBe(0)
    expect(appsList).toHaveBeenCalledWith({})
  })

  test('passes --running, --all and --device to core', async () => {
    const appsList = vi.fn(async () => list)
    await cli(['apps', '--running', '--all', '--device', 'VirtualDevice', '--json'], {
      ovd: stubApps({ list: appsList })
    })
    expect(appsList).toHaveBeenCalledWith({ device: 'VirtualDevice', running: true, all: true })
  })

  test('human output: one aligned row per app', async () => {
    const { stdout } = await cli(['apps'], { ovd: stubApps({ list: async () => list }) })
    expect(stdout).toBe('Sample Player  com.example.player  1.4.2 (142)  Running · pid 2108\n')
  })

  test('Appstore and system apps are marked; an empty version shows as a dash', async () => {
    const store: InstalledApp = {
      ...player,
      packageId: 'com.example.hellovega',
      title: 'Hello Vega',
      source: 'store',
      status: { state: 'stopped' }
    }
    const system: InstalledApp = {
      ...store,
      packageId: 'com.amazon.x',
      title: 'X',
      version: '',
      source: 'system'
    }
    const { stdout } = await cli(['apps', '--all'], {
      ovd: stubApps({ list: async () => ({ target, apps: [player, store, system] }) })
    })
    expect(stdout.split('\n')).toEqual([
      'Sample Player  com.example.player     1.4.2 (142)  Running · pid 2108',
      'Hello Vega     com.example.hellovega  1.4.2 (142)  Stopped · store',
      'X              com.amazon.x           — (142)      Stopped · system',
      ''
    ])
  })

  test('nothing installed: says so and how to install', async () => {
    const { stdout, stderr, exitCode } = await cli(['apps'], {
      ovd: stubApps({ list: async () => ({ target, apps: [] }) })
    })
    expect(stdout).toBe('No apps you installed on Vega Virtual Device.\n')
    expect(stderr).toContain('ovd apps install')
    expect(exitCode).toBe(0)
  })

  test('nothing running', async () => {
    const { stdout } = await cli(['apps', '--running'], {
      ovd: stubApps({ list: async () => ({ target, apps: [] }) })
    })
    expect(stdout).toBe('Nothing running on Vega Virtual Device.\n')
  })

  test.each([
    ['NO_TARGET', 4],
    ['TARGET_OFFLINE', 4],
    ['COMMAND_FAILED', 1]
  ] as const)('%s exits %i', async (code, exit) => {
    const { stdout, exitCode } = await cli(['apps', '--json'], {
      ovd: stubApps({ list: fail(code) })
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code } })
    expect(exitCode).toBe(exit)
  })
})

describe('ovd apps info', () => {
  const info: AppDetails = {
    target,
    app: {
      ...player,
      components: [{ ...main, type: 'interactive', launchType: 'singleton' }]
    }
  }

  test('--json prints the target and the app', async () => {
    const appInfo = vi.fn(async () => info)
    const { stdout, exitCode } = await cli(['apps', 'info', 'com.example.player', '--json'], {
      ovd: stubApps({ info: appInfo })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, target, app: info.app })
    expect(exitCode).toBe(0)
    expect(appInfo).toHaveBeenCalledWith('com.example.player', {})
  })

  test('without an app, asks core for the open one', async () => {
    const appInfo = vi.fn(async () => info)
    await cli(['apps', 'info', '--device', 'VirtualDevice', '--json'], {
      ovd: stubApps({ info: appInfo })
    })
    expect(appInfo).toHaveBeenCalledWith(undefined, { device: 'VirtualDevice' })
  })

  test('human output lists the components', async () => {
    const { stdout } = await cli(['apps', 'info', 'com.example.player'], {
      ovd: stubApps({ info: async () => info })
    })
    expect(stdout).toContain('Status     Running · pid 2108\n')
    expect(stdout).toContain('Source     Side-loaded\n')
    expect(stdout).toContain(
      'Components\n  com.example.player.main  interactive  VISIBLE · pid 2108\n'
    )
  })

  test.each([
    ['APP_NOT_INSTALLED', 1],
    ['NO_APP', 2],
    ['NOT_A_PROJECT', 2],
    ['TARGET_OFFLINE', 4]
  ] as const)('%s exits %i', async (code, exit) => {
    const { exitCode } = await cli(['apps', 'info', 'x', '--json'], {
      ovd: stubApps({ info: fail(code) })
    })
    expect(exitCode).toBe(exit)
  })
})

describe('ovd apps install', () => {
  test('is the same install as ovd install', async () => {
    const install = vi.fn(async () => Promise.reject(new Error('stop here')))
    await cli(['apps', 'install', 'p.vpkg', '--force', '--json'], { ovd: stubInstall({ install }) })
    expect(install).toHaveBeenCalledWith('p.vpkg', { force: true })
  })
})
