import type { PackageArch } from '../adapters/parseVptContents.js'

export type ArchVerdict = 'match' | 'mismatch' | 'unknown'

// ADR 0008: compare with what the target reports, never with its device type. A pure-JS
// package (`any`) installs everywhere; `unknown` (several or unrecognized `lib/` folders)
// blocks like a mismatch.
export function compareArch(pkg: PackageArch, target: string): ArchVerdict {
  if (pkg === 'any') return 'match'
  if (pkg === 'unknown') return 'unknown'
  return pkg === target ? 'match' : 'mismatch'
}
