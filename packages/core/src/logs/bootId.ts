import { parseBootId } from '../adapters/parseBootId.js'
import { vdaCmd } from '../sdk/commands.js'
import type { Runner } from '../sdk/runner.js'

// The one device command the boot tag adds: fixed, with no user input (the argument list never
// holds filter text; `vega exec vda shell` re-wraps it in a host `sh -c`, sdk.md).
export const BOOT_ID_ARGS = ['shell', 'cat', '/proc/sys/kernel/random/boot_id']
// A device that can't answer in this time has no boot ID for this stream.
export const BOOT_ID_TIMEOUT_MS = 5_000

// A `--boot` value as typed: `current`, or a boot ID with or without dashes. Returns `current`
// or the 32 lower-case hex characters, undefined for anything else.
export function normalizeBootFilter(value: string): string | undefined {
  const text = value.trim()
  if (text.toLowerCase() === 'current') return 'current'
  const hex = text.replaceAll('-', '').toLowerCase()
  return /^[0-9a-f]{32}$/.test(hex) ? hex : undefined
}

// Reads the device's boot ID at a stream start (also after a reconnect, which may follow a
// reboot). Never throws: a failed read (the command fails, the output isn't a UUID, the runner
// errors, or it is aborted) is an unknown boot ID, and the stream goes on without a tag.
export async function readBootId(opts: {
  runner: Runner
  vegaPath: string
  vdaSerial: string
  signal?: AbortSignal
}): Promise<string | undefined> {
  const spec = vdaCmd(opts.vegaPath, BOOT_ID_ARGS, opts.vdaSerial, {
    timeoutMs: BOOT_ID_TIMEOUT_MS,
    ...(opts.signal === undefined ? {} : { signal: opts.signal })
  })
  try {
    const result = await opts.runner.run(spec)
    if (result.exitCode !== 0) return undefined
    return parseBootId(result.stdout)
  } catch {
    return undefined
  }
}
