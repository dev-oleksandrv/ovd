import { Option, type Command } from 'commander'
import { logText, type LogEntry, type LogFilterInput } from '@ovd/core'
import type { CliDeps } from '../program.js'
import { reportError } from '../report.js'
import { reportContext } from './context.js'

// `ovd logs` follows the target's log until Ctrl+C, `--until`, or the stream's end.
// Human output, one line per entry (continuation lines indented to the message column):
//   07:27:00.257 E resmgr-app-registry         899 [AppRegistry] …
// `--json`: one JSON object per entry (JSON lines), never wrapped in a document:
//   {"time","level","priority","facility","process","pid","tid","tag","message","parsed"}
// A stream that ends by itself ends the output with the `{"ok":false,"error":…}` line, exit 1.

interface LogsOptions {
  app?: string
  system?: boolean
  level?: string
  since?: string
  until?: string
  grep?: string
  regex?: boolean
}

const COLORS: Record<LogEntry['level'], string> = {
  E: '\u001b[31m',
  W: '\u001b[33m',
  I: '\u001b[32m',
  D: '\u001b[36m'
}
const RESET = '\u001b[0m'

export function registerLogs(
  program: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  program
    .command('logs')
    .description('Follow the target’s log (Ctrl+C to stop)')
    .addOption(
      new Option('--app <id>', 'only the lines of this app (package ID)').conflicts('system')
    )
    .option('--system', 'only the lines of system processes')
    .option(
      '--level <level>',
      'minimum level: verbose, debug, info, warn, error (or v, d, i, w, e)'
    )
    .option('--since <time>', 'only lines from this time: ISO date-time, HH:MM[:SS] or 30s, 5m, 2h')
    .option('--until <time>', 'stop at this time: ISO date-time, HH:MM[:SS] or 30s, 5m, 2h')
    .option('--grep <text>', 'only lines whose message or tag contains this text')
    .option('--regex', 'treat --grep as a regular expression')
    .action(async (opts: LogsOptions, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      const color = deps.stdoutTty === true && deps.env.NO_COLOR === undefined
      const paintLevel = color
        ? (level: LogEntry['level'], text: string) => `${COLORS[level]}${text}${RESET}`
        : undefined
      const print = (entries: LogEntry[]) => {
        if (entries.length === 0) return
        const text = ctx.json
          ? entries.map((entry) => `${JSON.stringify(jsonOf(entry))}\n`).join('')
          : entries.map((entry) => logText(entry, paintLevel ? { paintLevel } : {})).join('')
        deps.output.stdout(text)
      }

      const controller = new AbortController()
      const dispose = deps.onInterrupt(() => controller.abort())
      try {
        let session
        try {
          session = await deps.ovd().logs.start({
            ...(ctx.device === undefined ? {} : { device: ctx.device }),
            filter: filterOf(opts),
            signal: controller.signal,
            // The CLI prints and forgets: core keeps no buffer for it.
            capacity: 0,
            onEntries: print
          })
        } catch (error) {
          // Ctrl+C before the first line is a normal stop.
          if (error instanceof Error && error.name === 'AbortError') return
          throw error
        }
        deps.output.stderr(`Following the log of ${session.target.name} (Ctrl+C to stop)…\n`)
        const end = await session.done
        if (end.reason === 'ended') reportError(ctx, end.error)
      } catch (error) {
        reportError(ctx, error)
      } finally {
        dispose()
      }
    })
}

function filterOf(opts: LogsOptions): LogFilterInput {
  return {
    ...(opts.app === undefined ? {} : { app: opts.app }),
    ...(opts.system ? { system: true } : {}),
    ...(opts.level === undefined ? {} : { level: opts.level }),
    ...(opts.since === undefined ? {} : { since: opts.since }),
    ...(opts.until === undefined ? {} : { until: opts.until }),
    ...(opts.grep === undefined ? {} : { search: opts.grep }),
    ...(opts.regex ? { regex: true } : {})
  }
}

// Picked explicitly: `seq` and `deviceTime` stay internal.
function jsonOf(entry: LogEntry) {
  return {
    time: entry.time,
    level: entry.level,
    priority: entry.priority,
    facility: entry.facility,
    process: entry.process,
    pid: entry.pid,
    tid: entry.tid,
    tag: entry.tag,
    message: entry.message,
    parsed: entry.parsed
  }
}
