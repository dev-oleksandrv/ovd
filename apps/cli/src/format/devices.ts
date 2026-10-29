import type { Device } from '@ovd/core'

const CONNECTION: Record<Device['connection'], string> = {
  usb: 'USB',
  wifi: 'Wi-Fi',
  local: 'Local'
}

const KIND: Record<Device['kind'], string> = {
  stick: 'Fire TV stick',
  vvd: 'Vega Virtual Device'
}

export function details(device: Device): string {
  return [CONNECTION[device.connection], device.info?.architecture, device.info?.os]
    .filter((part) => part)
    .join(' · ')
}

export function devicesTable(devices: Device[]): string {
  if (devices.length === 0) return 'No devices.\n'
  const rows = devices.map((d) => [
    `${d.isTarget ? '*' : ' '} ${d.name}`,
    d.id,
    details(d),
    d.status
  ])
  // The last column (status) isn't padded, so lines carry no trailing spaces.
  const widths = [0, 1, 2].map((col) => Math.max(...rows.map((r) => r[col]?.length ?? 0)))
  const line = (r: string[]) =>
    r.map((cell, col) => (col < widths.length ? cell.padEnd(widths[col] ?? 0) : cell)).join('  ')
  return `${rows.map(line).join('\n')}\n`
}

export function deviceRows(device: Device): string {
  const info = device.info
  const connection =
    CONNECTION[device.connection] + (device.ip === undefined ? '' : ` · ${device.ip}`)
  const rows: [string, string | undefined][] = [
    ['Name', device.name],
    ['ID', device.id],
    ['Status', device.status],
    ['Kind', KIND[device.kind]],
    ['OS', info?.os],
    ['Build', info?.build],
    ['Architecture', info?.architecture],
    ['Profile', info?.profile],
    ['Connection', connection],
    ['Serial', device.serial]
  ]
  const known = rows.filter((row): row is [string, string] => Boolean(row[1]))
  const width = Math.max(...known.map(([label]) => label.length))
  return known.map(([label, value]) => `${label.padEnd(width)}  ${value}\n`).join('')
}

export function targetLine(device: Device): string {
  const detail =
    device.status === 'online' ? (device.info?.architecture ?? 'online') : device.status
  return `Target: ${device.name} (${device.id} · ${detail})\n`
}
