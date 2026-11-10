import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { BuildType } from '../adapters/parseAppConfig.js'
import type { PrivateBuild } from './buildWatcher.js'

// `build/private/kepler/@amazon-devices/<name>/undefined/vega/<arch>/<Type>/…/<name>_<arch>.vpkg`
// (ARCHITECTURE §8) is about 8 levels deep.
const MAX_DEPTH = 10
const SEGMENTS = /[/\\]vega[/\\](armv7|aarch64|x86_64)[/\\](debug|release)[/\\]/i

// The packages `react-native build-vega` packs under `<folder>/build/private/`, which only the
// watch reads (`packages.builds` skips them): one newer than its public copy is a build still
// running. A missing folder is none.
export async function privateBuilds(folder: string): Promise<PrivateBuild[]> {
  const paths = await findVpkgs(join(folder, 'build', 'private'), 1)
  const found = await Promise.all(
    paths.map(async (path): Promise<PrivateBuild | undefined> => {
      const info = await stat(path).catch(() => undefined)
      if (!info?.isFile()) return undefined
      const segments = SEGMENTS.exec(path)
      return {
        path,
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
        ...(segments?.[1] && segments[2]
          ? {
              arch: segments[1].toLowerCase() as NonNullable<PrivateBuild['arch']>,
              buildType: segments[2].toLowerCase() as BuildType
            }
          : {})
      }
    })
  )
  return found.filter((b): b is PrivateBuild => b !== undefined)
}

async function findVpkgs(folder: string, depth: number): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
  const found: string[] = []
  for (const entry of entries) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH && entry.name !== 'node_modules') {
        found.push(...(await findVpkgs(path, depth + 1)))
      }
    } else if (entry.isFile() && /\.vpkg$/i.test(entry.name)) {
      found.push(path)
    }
  }
  return found
}
