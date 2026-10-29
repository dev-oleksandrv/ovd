import type { Device } from '@ovd/core'

export type Screen = 'devices'

export interface PaletteItem {
  label: string
  icon: string
  kind: 'Screen' | 'Action' | 'Device' | 'Coming in a later version'
  later: boolean
  run: () => void
}

// Screens of later stages: listed, never drawn as dead buttons (ADR 0018). Order from the design.
export const LATER: readonly (readonly [label: string, icon: string])[] = [
  ['Apps', 'apps'],
  ['Packages', 'deployed_code'],
  ['Logs', 'subject'],
  ['Crashes', 'bug_report'],
  ['Remote & Screen', 'settings_remote'],
  ['Shell', 'terminal'],
  ['Deep links', 'link'],
  ['Performance', 'monitoring'],
  ['Scenarios & MCP', 'account_tree']
]

// Stage 1 palette as shipped so far: Doctor, Virtual Device, setup and pairing entries join
// with their slices.
export function paletteItems(opts: {
  devices: Device[]
  target: string | null
  go: (screen: Screen) => void
  switchTarget: (device: Device) => void
  later: (label: string) => void
}): PaletteItem[] {
  return [
    {
      label: 'Go to Devices',
      icon: 'tv',
      kind: 'Screen',
      later: false,
      run: () => opts.go('devices')
    },
    ...opts.devices
      .filter((device) => device.id !== opts.target)
      .map((device): PaletteItem => ({
        label: `Switch target to ${device.name}`,
        icon: device.kind === 'vvd' ? 'desktop_windows' : 'tv',
        kind: 'Device',
        later: false,
        run: () => opts.switchTarget(device)
      })),
    ...LATER.map(([label, icon]): PaletteItem => ({
      label,
      icon,
      kind: 'Coming in a later version',
      later: true,
      run: () => opts.later(label)
    }))
  ]
}

export function filterItems(items: PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim().toLowerCase()
  return q ? items.filter((item) => item.label.toLowerCase().includes(q)) : items
}
