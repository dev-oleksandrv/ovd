import type { Device } from '@ovd/core'
import type { VvdBusy } from '../screens/devices/deviceView'

export type Screen = 'devices' | 'doctor'

export interface PaletteItem {
  // Unique per entry; labels are not (two devices can share a name).
  id: string
  label: string
  icon: string
  kind: 'Screen' | 'Action' | 'Device' | 'Coming in a later version' | `Unavailable · ${string}`
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

// Stage 1 palette as shipped so far: setup and pairing entries join with their slices.
export function paletteItems(opts: {
  devices: Device[]
  target: string | null
  go: (screen: Screen) => void
  runDoctor: () => void
  vvd: { busy: VvdBusy; start: () => void; stop: () => void }
  switchTarget: (device: Device) => void
  later: (label: string) => void
}): PaletteItem[] {
  return [
    {
      id: 'screen:devices',
      label: 'Go to Devices',
      icon: 'tv',
      kind: 'Screen',
      later: false,
      run: () => opts.go('devices')
    },
    {
      id: 'screen:doctor',
      label: 'Go to Doctor',
      icon: 'health_and_safety',
      kind: 'Screen',
      later: false,
      run: () => opts.go('doctor')
    },
    vvdItem(opts.devices, opts.vvd),
    {
      id: 'action:doctor',
      label: 'Run ovd doctor',
      icon: 'health_and_safety',
      kind: 'Action',
      later: false,
      run: opts.runDoctor
    },
    ...opts.devices
      .filter((device) => device.id !== opts.target)
      .map((device): PaletteItem => ({
        id: `device:${device.id}`,
        label: `Switch target to ${device.name}`,
        icon: device.kind === 'vvd' ? 'desktop_windows' : 'tv',
        kind: 'Device',
        later: false,
        run: () => opts.switchTarget(device)
      })),
    ...LATER.map(([label, icon]): PaletteItem => ({
      id: `later:${label}`,
      label,
      icon,
      kind: 'Coming in a later version',
      later: true,
      run: () => opts.later(label)
    }))
  ]
}

// While a start or stop runs, the other action is listed but unavailable (design `vvdPal`).
function vvdItem(
  devices: Device[],
  vvd: { busy: VvdBusy; start: () => void; stop: () => void }
): PaletteItem {
  const base = { id: 'action:vvd', icon: 'desktop_windows', later: false }
  if (vvd.busy) {
    const stopping = vvd.busy === 'stop'
    return {
      ...base,
      label: `${stopping ? 'Start' : 'Stop'} Virtual Device`,
      kind: `Unavailable · Virtual Device is ${stopping ? 'stopping' : 'starting'}`,
      later: true,
      run: () => {}
    }
  }
  const status = devices.find((d) => d.kind === 'vvd')?.status
  const running = status === 'online' || status === 'starting'
  return {
    ...base,
    label: `${running ? 'Stop' : 'Start'} Virtual Device`,
    kind: 'Action',
    run: running ? vvd.stop : vvd.start
  }
}

export function filterItems(items: PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim().toLowerCase()
  return q ? items.filter((item) => item.label.toLowerCase().includes(q)) : items
}
