export type PackageArch = 'armv7' | 'aarch64' | 'x86_64' | 'any' | 'unknown'

const KNOWN = new Set<string>(['armv7', 'aarch64', 'x86_64'])
const LIB = /^lib\/([^/]+)\//

// The architecture shows only in the native libraries' folder, `lib/<arch>/`, in
// `vpt show-contents`. A pure-JS package has no `lib/`: its packages for each architecture
// differ only in their signatures, so it installs on any target. Several or unrecognized
// folders give `unknown`, which the architecture guard treats as a mismatch (ADR 0008).
export function parseVptContents(stdout: string): { architecture: PackageArch } {
  const found = new Set<string>()
  for (const line of stdout.split('\n')) {
    const lib = LIB.exec(line.trim())
    if (lib?.[1]) found.add(lib[1])
  }
  if (found.size === 0) return { architecture: 'any' }
  const [only] = found
  if (found.size > 1 || only === undefined || !KNOWN.has(only)) return { architecture: 'unknown' }
  return { architecture: only as PackageArch }
}
