import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { OvdError } from '../errors/ovdError.js'

// Where pulled crash reports go: `OVD_CRASHES` if set, else `~/ovd/crashes`. The user's own
// files, like the captures, not host state, so it isn't under `OVD_HOME` (ADR 0022).
export function crashesDir(env: Record<string, string | undefined>, homedir: string): string {
  const override = env.OVD_CRASHES
  return override ? resolve(homedir, override) : join(homedir, 'ovd', 'crashes')
}

// Creates the folder (and its parents) with mode 0700 when it isn't there: a crash report holds
// memory contents of the app. A folder that exists keeps its mode, since `OVD_CRASHES` may be
// one the user chose on purpose.
export async function ensureCrashesDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : undefined
    throw new OvdError(
      'CRASH_PULL_FAILED',
      `Couldn’t create ${dir} (${code ?? (error instanceof Error ? error.message : String(error))})`,
      'Choose another folder with OVD_CRASHES or --out'
    )
  }
}
