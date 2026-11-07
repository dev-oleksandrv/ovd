import type { InstallResult } from '@ovd/core'

export function installedLine(result: Pick<InstallResult, 'package' | 'target'>): string {
  const { package: pkg, target } = result
  return `Installed ${pkg.file} (${pkg.id} ${pkg.version}) on ${target.name} · ${target.architecture}\n`
}

export function forcedWarning(result: Pick<InstallResult, 'package' | 'target'>): string {
  return `Warning: installed despite the architecture mismatch (--force): package is ${result.package.architecture}, ${result.target.name} is ${result.target.architecture}\n`
}
