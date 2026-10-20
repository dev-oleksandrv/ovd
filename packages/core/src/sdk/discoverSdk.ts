import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { parseVegaVersion, type VegaVersion } from '../adapters/parseVegaVersion.js'
import { OvdError } from '../errors/ovdError.js'
import { vegaCmd } from './commands.js'
import type { Runner } from './runner.js'

export interface SdkInfo {
  vegaPath: string
  cli: 'manager' | 'bundled'
  sdkVersion: string
  cliVersion?: string
}

export interface DiscoverOptions {
  runner: Runner
  env: Record<string, string | undefined>
  homedir: string
  isExecutable: (path: string) => Promise<boolean>
}

const INSTALL_HINT =
  'Install the Vega SDK and Vega CLI: https://developer.amazon.com/docs/vega/0.24/sdk-manager.html'

// A desktop app started from Finder doesn't get the shell PATH, so the SDK Manager's default
// location is always a candidate. A bundled `vega` can shadow the manager on PATH; the manager
// wins because only it has `vega sdk` and `vega devmode`.
export async function discoverSdk(opts: DiscoverOptions): Promise<SdkInfo> {
  const tried = candidates(opts.env, opts.homedir)
  let bundled: SdkInfo | undefined
  for (const path of tried) {
    if (!(await opts.isExecutable(path))) continue
    const version = await probe(opts.runner, path)
    if (version?.cli === 'manager') return { vegaPath: path, ...version }
    if (version && !bundled) bundled = { vegaPath: path, ...version }
  }
  if (bundled) return bundled
  throw new OvdError('SDK_NOT_FOUND', 'No Vega SDK found', INSTALL_HINT, { tried })
}

export function defaultDiscoverOptions(runner: Runner): DiscoverOptions {
  return {
    runner,
    env: process.env,
    homedir: homedir(),
    isExecutable: async (path) => {
      try {
        await access(path, constants.X_OK)
        return true
      } catch {
        return false
      }
    }
  }
}

function candidates(env: Record<string, string | undefined>, home: string): string[] {
  if (env.OVD_VEGA) return [env.OVD_VEGA]
  const fromPath = (env.PATH ?? '')
    .split(delimiter)
    .filter((dir) => dir !== '')
    .map((dir) => join(dir, 'vega'))
  return [...new Set([...fromPath, join(home, 'vega', 'bin', 'vega')])]
}

async function probe(runner: Runner, path: string): Promise<VegaVersion | undefined> {
  try {
    const result = await runner.run(vegaCmd(path, ['--version'], { timeoutMs: 10_000 }))
    if (result.exitCode !== 0) return undefined
    return parseVegaVersion(result.stdout)
  } catch (error) {
    if (error instanceof OvdError) return undefined
    throw error
  }
}
