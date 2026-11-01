import type { InstallResult } from '@ovd/core'

export function installedLine(result: InstallResult): string {
  const { package: pkg, target } = result
  return `Installed ${pkg.file} (${pkg.id} ${pkg.version}) on ${target.name} · ${target.architecture}\n`
}
