import { describe, expect, test } from 'vitest'
import type { InstalledApp, LaunchResult, TerminateResult } from '@ovd/core'
import {
  actionToast,
  appActionCli,
  appInfoCli,
  appsBlocker,
  canUninstall,
  detailActions,
  withDetail,
  appsCli,
  componentRows,
  infoRows,
  installedText,
  runningNowEmpty,
  statusView,
  tabCounts,
  visibleApps
} from '../../../../src/renderer/src/screens/apps/appsView'
import { stick, vvd } from '../devices/sample'
import { hello, player } from './sample'

const now = new Date('2026-11-05T18:00:00')

describe('appsView', () => {
  test('CLI echoes', () => {
    expect(appsCli('VirtualDevice')).toBe('ovd apps --device VirtualDevice')
    expect(appInfoCli('com.example.player', 'G070000000000001')).toBe(
      'ovd apps info com.example.player --device G070000000000001'
    )
  })

  test.each([
    [player, { tone: 'ok', label: 'Running · 4182' }],
    [hello, { tone: 'muted', label: 'Stopped' }]
  ])('status of %s', (app, view) => {
    expect(statusView(app)).toEqual(view)
  })

  test('tabs count and filter', () => {
    expect(tabCounts([player, hello])).toEqual({ installed: 2, running: 1 })
    expect(visibleApps([player, hello], 'running')).toEqual([player])
    expect(visibleApps([player, hello], 'installed')).toEqual([player, hello])
  })

  test.each([
    [new Date(2026, 10, 5, 14, 2).toISOString(), 'Today 14:02'],
    [new Date(2026, 8, 30, 9, 0).toISOString(), 'Sep 30']
  ])('installed %s', (iso, text) => {
    expect(installedText(iso, now)).toBe(text)
  })

  test('info rows: what the device reports, "—" for what only OVD’s own installs will know', () => {
    expect(infoRows(player, now).map((r) => [r.label, r.value])).toEqual([
      ['Version', '1.4.2 (142)'],
      ['Build type', '—'],
      ['Size', '—'],
      ['Installed', installedText(player.installedAt, now)],
      ['Lifespan', 'PERMANENT'],
      ['Running for', '—']
    ])
    expect(infoRows(hello, now).find((r) => r.label === 'Lifespan')?.value).toBe('—')
  })

  test('component rows', () => {
    expect(componentRows(player)).toEqual([
      {
        id: 'com.example.player.main',
        type: '',
        state: 'VISIBLE',
        pid: 'pid 4182',
        container: 'framework.slice/essential/4182',
        running: true
      }
    ])
    expect(componentRows(hello)[0]).toMatchObject({
      state: 'STOPPED',
      pid: 'pid —',
      running: false
    })
  })

  test('blockers', () => {
    expect(appsBlocker(undefined)).toBe('no-target')
    expect(appsBlocker({ ...stick, status: 'offline' })).toBe('offline')
    expect(appsBlocker(stick)).toBeNull()
  })

  test.each([
    ['a stopped Virtual Device', vvd, 'Virtual Device is stopped'],
    ['an offline stick', { ...stick, status: 'offline' as const }, 'Device is offline'],
    ['an online stick', stick, 'No apps running']
  ])('Running now when empty: %s', (_name, device, text) => {
    expect(runningNowEmpty(device)).toBe(text)
  })

  test.each([
    ['launch', 'ovd apps launch com.example.player --device VirtualDevice'],
    ['terminate', 'ovd apps terminate com.example.player --device VirtualDevice'],
    ['force-stop', 'ovd apps terminate com.example.player --force --device VirtualDevice'],
    ['restart', 'ovd apps restart com.example.player --device VirtualDevice'],
    ['uninstall', 'ovd apps uninstall com.example.player --device VirtualDevice'],
    ['reinstall', 'ovd apps reinstall com.example.player --device VirtualDevice']
  ] as const)('the CLI echo of %s', (action, cli) => {
    expect(appActionCli(action, 'com.example.player', 'VirtualDevice')).toBe(cli)
  })

  test.each([
    ['a running app', player, ['restart', 'terminate', 'force-stop']],
    ['a stopped app', hello, ['launch']]
  ])('detail actions of %s', (_name, app, actions) => {
    expect(detailActions(app)).toEqual(actions)
  })

  test.each([
    ['sideloaded', true],
    ['store', false],
    ['system', false]
  ] as const)('a %s app can be uninstalled: %s', (source, can) => {
    expect(canUninstall({ ...player, source })).toBe(can)
  })

  const target = { id: 'VirtualDevice', name: 'Vega Virtual Device' }
  const app = { packageId: player.packageId, title: player.title }
  const launched: LaunchResult = {
    target,
    app: { ...app, componentId: 'com.example.player.main' },
    launched: true
  }
  const stopped: TerminateResult = { target, app, forced: false, wasRunning: true }

  test.each([
    ['launch', launched, { tone: 'ok', text: 'Launched Sample Player' }],
    ['terminate', stopped, { tone: 'ok', text: 'Stopped Sample Player' }],
    [
      'terminate',
      { ...stopped, wasRunning: false },
      { tone: 'info', text: 'Sample Player wasn’t running' }
    ],
    [
      'force-stop',
      { ...stopped, forced: true, wasRunning: null },
      { tone: 'ok', text: 'Force stopped Sample Player' }
    ],
    ['restart', { ...launched, wasRunning: true }, { tone: 'ok', text: 'Restarted Sample Player' }],
    [
      'uninstall',
      { target, app, uninstalled: true },
      { tone: 'ok', text: 'Uninstalled Sample Player' }
    ]
  ] as const)('toast after %s', (action, result, toast) => {
    expect(actionToast(action, player, result)).toEqual(toast)
  })

  test('withDetail keeps the list’s running state and takes the detail’s component types', () => {
    const cached: InstalledApp = {
      ...hello,
      components: [
        { id: 'com.example.hellovega.main', type: 'interactive', launchType: 'singleton' }
      ]
    }
    const fresh: InstalledApp = {
      ...hello,
      status: { state: 'running', pid: 5120, lifespan: 'PERMANENT' },
      components: [
        {
          id: 'com.example.hellovega.main',
          running: { pid: 5120, state: 'VISIBLE', lifespan: 'PERMANENT', container: 'c' }
        }
      ]
    }
    expect(withDetail(fresh, cached)).toEqual({
      ...fresh,
      components: [
        {
          id: 'com.example.hellovega.main',
          type: 'interactive',
          launchType: 'singleton',
          running: { pid: 5120, state: 'VISIBLE', lifespan: 'PERMANENT', container: 'c' }
        }
      ]
    })
    expect(withDetail(fresh, undefined)).toBe(fresh)
    expect(withDetail(fresh, player)).toBe(fresh)
  })
})
