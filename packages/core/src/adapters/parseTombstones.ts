import { z } from 'zod'
import { parseJson } from './unexpectedOutput.js'

// One crash report in the vault, from its file name (fixtures/0.24/loggingctl-vault-ls).
export interface Tombstone {
  // The vault index `loggingctl vault --cat SYSTEM_TOMBSTONE <index>` takes, as printed.
  index: string
  epochS: number
  pid: number
  signal: number
  // The package ID with its dots as `_` (`com_example_player`).
  packageUnderscored: string
}

const schema = z.object({ artifacts: z.array(z.string()), status: z.number() })
// `<index>#crash_<epoch s>_<uid>_<gid>_<pid>_<signal>_<package, dots as _>.acr`
const NAME = /^(\d+)#crash_(\d+)_(\d+)_(\d+)_(\d+)_(\d+)_(.+)\.acr$/

// `loggingctl vault --ls SYSTEM_TOMBSTONE/acr`: JSON, not sorted. Enrichment only: anything
// unreadable gives no tombstones, never an error, so a launch is still reported.
export function parseTombstones(stdout: string): Tombstone[] {
  const parsed = schema.safeParse(parseJson(stdout))
  if (!parsed.success || parsed.data.status !== 0) return []
  return parsed.data.artifacts.flatMap((name) => {
    const m = NAME.exec(name)
    if (!m) return []
    const [, index = '', epochS, , , pid, signal, packageUnderscored = ''] = m
    return [
      {
        index,
        epochS: Number(epochS),
        pid: Number(pid),
        signal: Number(signal),
        packageUnderscored
      }
    ]
  })
}

// The standard Linux signal numbers; the same on armv7 and aarch64. Only 6 is recorded.
const SIGNALS: Record<number, string> = {
  4: 'SIGILL',
  5: 'SIGTRAP',
  6: 'SIGABRT',
  7: 'SIGBUS',
  8: 'SIGFPE',
  9: 'SIGKILL',
  11: 'SIGSEGV',
  15: 'SIGTERM'
}

export function signalName(n: number): string | undefined {
  return SIGNALS[n]
}
