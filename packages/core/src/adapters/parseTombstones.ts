import { z } from 'zod'
import { OvdError } from '../errors/ovdError.js'
import { parseJson, unexpectedOutput } from './unexpectedOutput.js'

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
// `<index>#crash_<epoch s>_<uid>_<gid>_<pid>_<signal>_<package, dots as _>.acr`. Every part is
// bounded: the names come from the device, and the index ends up in a device script and the
// package in a scope match. The index has no leading zero, so the number is the printed text.
// The package part is the characters of an app ID, with `.` already turned into `_`.
const NAME =
  /^(0|[1-9]\d{0,8})#crash_(\d{1,12})_(\d{1,10})_(\d{1,10})_(\d{1,10})_(\d{1,3})_([A-Za-z0-9_-]{1,200})\.acr$/
const MAX_NAME_LENGTH = 300
// The input is bounded by its size, not by a count of names, so no name is dropped before the
// listing is sorted: a listing over this many bytes is unreadable.
export const MAX_LISTING_BYTES = 4 * 1024 * 1024
// The Crashes screen keeps this many names, the newest, after validating and sorting all.
export const MAX_LISTING_NAMES = 5_000

function parseListing(stdout: string): unknown {
  return Buffer.byteLength(stdout) > MAX_LISTING_BYTES ? undefined : parseJson(stdout)
}

function tombstones(names: string[]): Tombstone[] {
  return names.flatMap((name) => {
    if (name.length > MAX_NAME_LENGTH) return []
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

// `loggingctl vault --ls SYSTEM_TOMBSTONE/acr`: JSON, not sorted. Enrichment only: anything
// unreadable gives no tombstones, never an error, so a launch is still reported.
export function parseTombstones(stdout: string): Tombstone[] {
  const parsed = schema.safeParse(parseListing(stdout))
  if (!parsed.success || parsed.data.status !== 0) return []
  return tombstones(parsed.data.artifacts)
}

// The listing for the Crashes screen, where an unreadable listing is an error, not "no crashes":
// `-7` (`Insufficient permissions`) is CRASH_ACCESS_DENIED, anything else that isn't a listing
// is UNEXPECTED_OUTPUT. Names that don't match the strict pattern are skipped.
export function parseTombstonesStrict(stdout: string): Tombstone[] {
  const json = parseListing(stdout)
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    const status = z.object({ status: z.number() }).safeParse(json)
    if (status.success && status.data.status === -7) throw accessDenied()
    throw unexpectedOutput('the crash reports', stdout)
  }
  if (parsed.data.status === -7) throw accessDenied()
  if (parsed.data.status !== 0) throw unexpectedOutput('the crash reports', stdout)
  return tombstones(parsed.data.artifacts)
    .sort((a, b) => b.epochS - a.epochS || Number(b.index) - Number(a.index))
    .slice(0, MAX_LISTING_NAMES)
}

function accessDenied(): OvdError {
  return new OvdError(
    'CRASH_ACCESS_DENIED',
    'The device refused to list its crash reports',
    'Crash reports are readable only while the app is installed'
  )
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
