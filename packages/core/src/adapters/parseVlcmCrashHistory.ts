import { unexpectedOutput } from './unexpectedOutput.js'

// One entry of `vlcm crash-history` (fixtures/0.24/vlcm-crash-history).
export interface CrashEntry {
  pid: number
  packageId: string
  // Device uptime at the crash, as printed (`35.949805640s`); with `pid` it tells entries apart.
  timestamp: string
  // From `LCM_KILLTIME: … (epoch ms: <n>)`.
  killTimeMs: number
}

const HEADER = /^AppCrashInfoBuffer:\s*$/m
const SIZE = /^\s*Size:\s*(\d+)\s*$/m
const ENTRY = /^\s*\[\d+\]\s+pid:\s*(\d+)\s*$/
const PACKAGE = /^\s*packageId:\s*(\S+)\s*$/m
const TIMESTAMP = /^\s*timestamp:\s*(\S+)\s*$/m
const KILL_TIME = /^\s*LCM_KILLTIME:.*\(epoch ms:\s*(\d+)\)\s*$/m

// A text listing, newest first, of every package's crashes since boot; no JSON mode. Every
// recorded entry, a system package's too, has `LCM_KILLTIME` with its epoch ms, so an entry
// without it is a format change, not a crash to skip. Other metadata lines are ignored.
export function parseVlcmCrashHistory(stdout: string): CrashEntry[] {
  const text = stdout.replace(/\r\n/g, '\n')
  const size = SIZE.exec(text)
  if (!HEADER.test(text) || !size) throw unexpectedOutput('vlcm crash-history', stdout)

  const blocks: { pid: number; lines: string[] }[] = []
  for (const line of text.split('\n')) {
    const start = ENTRY.exec(line)
    if (start) blocks.push({ pid: Number(start[1]), lines: [] })
    else blocks.at(-1)?.lines.push(line)
  }

  const entries = blocks.map(({ pid, lines }) => {
    const block = lines.join('\n')
    const packageId = PACKAGE.exec(block)?.[1]
    const timestamp = TIMESTAMP.exec(block)?.[1]
    const killTime = KILL_TIME.exec(block)?.[1]
    if (!packageId || !timestamp || !killTime) throw unexpectedOutput('vlcm crash-history', stdout)
    // The verifier turns it into an ISO time; a number outside the date range would throw a
    // plain RangeError there, past the activity log, so it is a format change here.
    const killTimeMs = Number(killTime)
    if (!Number.isSafeInteger(killTimeMs) || Number.isNaN(new Date(killTimeMs).getTime())) {
      throw unexpectedOutput('vlcm crash-history', stdout)
    }
    return { pid, packageId, timestamp, killTimeMs }
  })
  if (entries.length !== Number(size[1])) throw unexpectedOutput('vlcm crash-history', stdout)
  return entries
}
