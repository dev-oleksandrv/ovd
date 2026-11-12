import type { Device } from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import type { VvdBusy } from '../../../src/renderer/src/screens/devices/deviceView'
import { filterItems, LATER, paletteItems } from '../../../src/renderer/src/shell/paletteItems'
import { stick, vvd, wifiOffline } from '../screens/devices/sample'

const build = (
  target: string | null,
  busy: VvdBusy = null,
  devices: Device[] = [stick, vvd, wifiOffline]
) => {
  const opts = {
    go: vi.fn(),
    runDoctor: vi.fn(),
    exportLogs: vi.fn(),
    setup: vi.fn(),
    pair: vi.fn(),
    switchTarget: vi.fn(),
    later: vi.fn()
  }
  const vvdOpts = { busy, start: vi.fn(), stop: vi.fn() }
  return { opts, vvdOpts, items: paletteItems({ devices, target, vvd: vvdOpts, ...opts }) }
}

describe('paletteItems', () => {
  test('lists Devices, Apps, Packages, Logs, Remote & Screen, Doctor, a switch per other device, then every later screen', () => {
    const { items } = build(stick.id)
    expect(items.map((i) => [i.label, i.kind])).toEqual([
      ['Go to Devices', 'Screen'],
      ['Go to Apps', 'Screen'],
      ['Go to Packages', 'Screen'],
      ['Go to Logs', 'Screen'],
      ['Go to Remote & Screen', 'Screen'],
      ['Go to Doctor', 'Screen'],
      ['Set up a new stick (Developer Mode)', 'Action'],
      ['Pair a device over Wi‑Fi…', 'Action'],
      ['Start Virtual Device', 'Action'],
      ['Run ovd doctor', 'Action'],
      ['Export logs as plain text…', 'Action'],
      ['Export logs as JSON lines…', 'Action'],
      ['Switch target to Vega Virtual Device', 'Device'],
      ['Switch target to Bedroom stick', 'Device'],
      ...LATER.map(([label]) => [label, 'Coming in a later version'])
    ])
    expect(items.find((i) => i.label.includes('Virtual'))?.icon).toBe('desktop_windows')
  })

  test('with no target every device gets a switch entry', () => {
    const { items } = build(null)
    expect(items.filter((i) => i.kind === 'Device')).toHaveLength(3)
  })

  test('entries run their action', () => {
    const { opts, items } = build(stick.id)
    items.find((i) => i.label === 'Switch target to Bedroom stick')?.run()
    expect(opts.switchTarget).toHaveBeenCalledWith(wifiOffline)
    items.find((i) => i.label === 'Crashes')?.run()
    expect(opts.later).toHaveBeenCalledWith('Crashes')
    items[0]?.run()
    expect(opts.go).toHaveBeenCalledWith('devices')
    items[1]?.run()
    expect(opts.go).toHaveBeenCalledWith('apps')
    items[2]?.run()
    expect(opts.go).toHaveBeenCalledWith('packages')
    items[3]?.run()
    expect(opts.go).toHaveBeenCalledWith('logs')
    items[4]?.run()
    expect(opts.go).toHaveBeenCalledWith('remote')
    items[5]?.run()
    expect(opts.go).toHaveBeenCalledWith('doctor')
    items[6]?.run()
    expect(opts.setup).toHaveBeenCalled()
    items[7]?.run()
    expect(opts.pair).toHaveBeenCalled()
    items[9]?.run()
    expect(opts.runDoctor).toHaveBeenCalled()
    items[10]?.run()
    expect(opts.exportLogs).toHaveBeenLastCalledWith('text')
    items[11]?.run()
    expect(opts.exportLogs).toHaveBeenLastCalledWith('jsonl')
  })

  test('filters by a case-insensitive substring, ignoring surrounding spaces', () => {
    const { items } = build(stick.id)
    expect(filterItems(items, '  DEEP ').map((i) => i.label)).toEqual(['Deep links'])
    expect(LATER.map(([label]) => label)).not.toContain('Remote & Screen')
    expect(filterItems(items, '')).toHaveLength(items.length)
  })

  test.each([
    ['stopped', 'stopped', 'Start Virtual Device', 'start'],
    ['booting', 'starting', 'Stop Virtual Device', 'stop'],
    ['running', 'online', 'Stop Virtual Device', 'stop']
  ] as const)('Virtual Device %s: %s', (_name, status, label, action) => {
    const { items, vvdOpts } = build(stick.id, null, [stick, { ...vvd, status }])
    const item = items.find((i) => i.id === 'action:vvd')
    expect(item).toMatchObject({ label, kind: 'Action', later: false })
    item?.run()
    expect(vvdOpts[action]).toHaveBeenCalled()
  })

  test.each([
    ['start', 'Stop Virtual Device', 'Unavailable · Virtual Device is starting'],
    ['stop', 'Start Virtual Device', 'Unavailable · Virtual Device is stopping']
  ] as const)('while busy (%s) the other action is unavailable', (busy, label, kind) => {
    const { items, vvdOpts } = build(stick.id, busy)
    const item = items.find((i) => i.id === 'action:vvd')
    expect(item).toMatchObject({ label, kind, later: true })
    item?.run()
    expect(vvdOpts.start).not.toHaveBeenCalled()
    expect(vvdOpts.stop).not.toHaveBeenCalled()
  })
})
