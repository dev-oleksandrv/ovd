import type { PackageBuild, PackageInfo } from '@ovd/core'
import type { KeyValue } from '../../ui/KeyValueGrid'

const BUILD_TYPE = { debug: 'Debug', release: 'Release', unknown: 'Unknown' } as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Decimal units, as `ovd pkg` prints them: 2817790 → "2.8 MB".
export function sizeText(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`
  return `${bytes} B`
}

// "14:02" today, "Oct 12" before (design `when`).
export function whenText(iso: string, now: Date): string {
  const d = new Date(iso)
  const today =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return today
    ? `${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

export function archLabel(arch: PackageInfo['architecture']): string {
  return arch === 'any' ? 'any (no native code)' : arch
}

export function buildTypeLabel(type: PackageInfo['buildType']): string {
  return BUILD_TYPE[type]
}

// A row's chip and build type: what the package says once read, else the build folder's name.
export function rowTags(
  build: PackageBuild,
  info: PackageInfo | undefined
): { arch: string | null; type: string | null } {
  if (info) return { arch: info.architecture, type: buildTypeLabel(info.buildType) }
  return {
    arch: build.folderArch ?? null,
    type: build.folderBuildType ? buildTypeLabel(build.folderBuildType) : null
  }
}

// Overview rows, in the design's order.
export function overviewRows(info: PackageInfo): KeyValue[] {
  return [
    { label: 'Package ID', value: info.id, mono: true },
    { label: 'Title', value: info.title },
    { label: 'Version', value: info.version, mono: true },
    { label: 'Build', value: String(info.buildNumber), mono: true },
    { label: 'Architecture', value: archLabel(info.architecture), mono: true },
    { label: 'Build type', value: buildTypeLabel(info.buildType) },
    { label: 'Size', value: `${sizeText(info.size)} · ${sizeText(info.unpackedSize)} unpacked` },
    { label: 'SHA-384', value: info.sha384, mono: true }
  ]
}

export function infoCli(displayPath: string): string {
  return `ovd pkg info ${displayPath}`
}

// A dropped or picked file, listed with the builds for the rest of the session.
export function inspectedBuild(info: PackageInfo): PackageBuild {
  const slash = info.displayPath.lastIndexOf('/')
  return {
    path: info.path,
    displayPath: info.displayPath,
    file: info.file,
    folder: slash < 0 ? '' : info.displayPath.slice(0, slash + 1),
    size: info.size,
    modifiedAt: info.modifiedAt
  }
}
