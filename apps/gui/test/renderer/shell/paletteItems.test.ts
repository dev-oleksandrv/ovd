import { describe, expect, test, vi } from 'vitest'
import { filterItems, LATER, paletteItems } from '../../../src/renderer/src/shell/paletteItems'
import { stick, vvd, wifiOffline } from '../screens/devices/sample'

const build = (target: string | null) => {
  const opts = { go: vi.fn(), runDoctor: vi.fn(), switchTarget: vi.fn(), later: vi.fn() }
  return { opts, items: paletteItems({ devices: [stick, vvd, wifiOffline], target, ...opts }) }
}

describe('paletteItems', () => {
  test('lists Devices, Doctor, a switch per other device, then every later screen', () => {
    const { items } = build(stick.id)
    expect(items.map((i) => [i.label, i.kind])).toEqual([
      ['Go to Devices', 'Screen'],
      ['Go to Doctor', 'Screen'],
      ['Run ovd doctor', 'Action'],
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
    items.find((i) => i.label === 'Logs')?.run()
    expect(opts.later).toHaveBeenCalledWith('Logs')
    items[0]?.run()
    expect(opts.go).toHaveBeenCalledWith('devices')
    items[1]?.run()
    expect(opts.go).toHaveBeenCalledWith('doctor')
    items[2]?.run()
    expect(opts.runDoctor).toHaveBeenCalled()
  })

  test('filters by a case-insensitive substring, ignoring surrounding spaces', () => {
    const { items } = build(stick.id)
    expect(filterItems(items, '  DEEP ').map((i) => i.label)).toEqual(['Deep links'])
    expect(filterItems(items, '')).toHaveLength(items.length)
  })
})
