import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ErrorCode } from '../errors/ovdError.js'

export type Surface = 'cli' | 'desktop' | 'mcp' | 'action'

export type ActivityAction =
  | 'target.set'
  | 'device.rename'
  | 'vvd.start'
  | 'vvd.stop'
  | 'vvd.devmode.enable'
  | 'devmode.enable'
  | 'pair.tcpip'
  | 'pair.connect'
  | 'connect'
  | 'forget'

export interface ActivityEntry {
  time: string
  surface: Surface
  action: ActivityAction
  target: string | null
  args: Record<string, string | number | boolean>
  result: 'ok' | 'error'
  errorCode?: ErrorCode
}

export interface ActivityLog {
  append(entry: Omit<ActivityEntry, 'time' | 'surface'>): Promise<void>
}

const MAX_BYTES = 5 * 1024 * 1024

// Host-side, append-only record of device actions (ADR 0011, ADR 0022). Each surface runs its
// own core, so appends rely on O_APPEND to interleave whole lines across processes.
export function createActivityLog(opts: {
  home: string
  surface: Surface
  now?: () => Date
  maxBytes?: number
}): ActivityLog {
  const file = join(opts.home, 'activity.jsonl')
  const now = opts.now ?? (() => new Date())
  const maxBytes = opts.maxBytes ?? MAX_BYTES

  return {
    async append(entry) {
      await mkdir(opts.home, { recursive: true, mode: 0o700 })
      if ((await sizeOf(file)) >= maxBytes) await rename(file, join(opts.home, 'activity.1.jsonl'))
      const line: ActivityEntry = { time: now().toISOString(), surface: opts.surface, ...entry }
      await appendFile(file, `${JSON.stringify(line)}\n`, { flag: 'a', mode: 0o600 })
    }
  }
}

async function sizeOf(file: string): Promise<number> {
  try {
    return (await stat(file)).size
  } catch {
    return 0
  }
}
