import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  parseEmulatorDiscovery,
  type EmulatorDiscovery
} from '../adapters/parseEmulatorDiscovery.js'
import { OvdError } from '../errors/ovdError.js'

// Where the emulator writes `pid_<qemu pid>.ini` once gRPC is on. macOS is verified
// (ARCHITECTURE §8); the Linux folders follow the Android emulator and are unverified.
// `OVD_EMULATOR_DISCOVERY_DIR` replaces the list (e2e sandboxes).
export function discoveryDirectories(opts: {
  homedir: string
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
  uid?: number
}): string[] {
  const override = opts.env.OVD_EMULATOR_DISCOVERY_DIR
  if (override) return [override]
  if (opts.platform === 'darwin') {
    return [join(opts.homedir, 'Library/Caches/TemporaryItems/avd/running')]
  }
  return [
    ...(opts.env.XDG_RUNTIME_DIR ? [join(opts.env.XDG_RUNTIME_DIR, 'avd/running')] : []),
    ...(opts.uid !== undefined ? [`/run/user/${opts.uid}/avd/running`] : []),
    join(opts.homedir, '.android/avd/running')
  ]
}

export interface DiscoveryDeps {
  directories: string[]
  // Whether a process runs; a crashed emulator leaves its file behind.
  isAlive: (pid: number) => boolean
}

const FILE = /^pid_(\d+)\.ini$/

// The newest discovery file of a live emulator with this console port, or null.
export async function findDiscovery(
  deps: DiscoveryDeps,
  consolePort: number
): Promise<EmulatorDiscovery | null> {
  const found: { discovery: EmulatorDiscovery; mtime: number }[] = []
  for (const dir of deps.directories) {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      const pid = Number(FILE.exec(name)?.[1])
      if (!pid || !deps.isAlive(pid)) continue
      const file = join(dir, name)
      try {
        const [text, info] = await Promise.all([readFile(file, 'utf8'), stat(file)])
        const discovery = parseEmulatorDiscovery(text)
        if (discovery.consolePort === consolePort) {
          found.push({ discovery, mtime: info.mtimeMs })
        }
      } catch (error) {
        // Removed meanwhile, or half written: not this emulator's file yet.
        if (error instanceof OvdError || isFsError(error)) continue
        throw error
      }
    }
  }
  found.sort((a, b) => b.mtime - a.mtime)
  return found[0]?.discovery ?? null
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: it runs, as another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function isFsError(error: unknown): boolean {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).code === 'string'
}
