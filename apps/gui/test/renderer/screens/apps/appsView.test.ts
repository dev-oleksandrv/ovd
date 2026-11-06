import { describe, expect, test } from 'vitest'
import {
  appInfoCli,
  appsBlocker,
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
})
