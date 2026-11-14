import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { OvdError } from '../errors/ovdError.js'

// Where log bundles go: `OVD_BUNDLES` if set, else `~/ovd/bundles`. The user's own files, like
// the captures and crash reports, not host state, so it isn't under `OVD_HOME` (ADR 0022, 0026).
export function bundlesDir(env: Record<string, string | undefined>, homedir: string): string {
  const override = env.OVD_BUNDLES
  return override ? resolve(homedir, override) : join(homedir, 'ovd', 'bundles')
}

// Creates the folder (and its parents) with mode 0700 when it isn't there: a bundle holds device
// logs. A folder that exists keeps its mode, since `OVD_BUNDLES` may be one the user chose.
export async function ensureBundlesDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : undefined
    throw new OvdError(
      'LOG_BUNDLE_FAILED',
      `Couldn’t create ${dir} (${code ?? (error instanceof Error ? error.message : String(error))})`,
      'Choose another folder with OVD_BUNDLES or --out'
    )
  }
}
