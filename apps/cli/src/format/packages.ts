import type { PackageBuild, PackageInfo } from '@ovd/core'

const BUILD_TYPE = { debug: 'Debug', release: 'Release', unknown: 'unknown' } as const

// Decimal units, as file managers show sizes: 2817790 → "2.8 MB".
export function sizeText(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`
  return `${bytes} B`
}

export function archText(arch: PackageInfo['architecture']): string {
  return arch === 'any' ? 'any (no native code)' : arch
}

export function packageRows(pkg: PackageInfo): string {
  const rows: [string, string][] = [
    ['Title', pkg.title],
    ['Package ID', pkg.id],
    ['Version', `${pkg.version} (${pkg.buildNumber})`],
    ['Architecture', archText(pkg.architecture)],
    ['Build type', BUILD_TYPE[pkg.buildType]],
    ['Size', sizeText(pkg.size)],
    ['OS versions', pkg.osVersions.join(', ') || '—'],
    ['SHA-384', pkg.sha384],
    ['Path', pkg.displayPath]
  ]
  const width = Math.max(...rows.map(([label]) => label.length))
  return rows.map(([label, value]) => `${label.padEnd(width)}  ${value}\n`).join('')
}

// "2026-11-01 14:05" in local time.
function timeText(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// The folder hints are what the build folder says; `ovd pkg info` reads the package itself.
export function buildsTable(builds: PackageBuild[]): string {
  const rows = builds.map((b) => [
    `${b.folder}${b.file}`,
    b.folderArch ?? '—',
    b.folderBuildType ? BUILD_TYPE[b.folderBuildType] : '—',
    sizeText(b.size),
    timeText(b.modifiedAt)
  ])
  const widths = [0, 1, 2, 3].map((col) => Math.max(...rows.map((r) => r[col]?.length ?? 0)))
  const line = (r: string[]) =>
    r.map((cell, col) => (col < widths.length ? cell.padEnd(widths[col] ?? 0) : cell)).join('  ')
  return `${rows.map(line).join('\n')}\n`
}
