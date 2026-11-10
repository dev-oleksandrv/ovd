import { Option, type Command } from 'commander'
import {
  LOG_EXPORT_FORMATS,
  logJson,
  logText,
  openLogExport,
  type LogEntry,
  type LogExportFormat,
  type LogExportWriter,
  type LogFilterInput
} from '@ovd/core'
import type { CliDeps } from '../program.js'
import { reportError } from '../report.js'
import { reportContext } from './context.js'

// `ovd logs` follows the target's log until Ctrl+C, `--until`, or reconnecting gives up. It
// restarts the stream after every install OVD makes on the target (`--no-restart-after-install`
// keeps it running) and reconnects by itself when the device drops.
// Human output, one line per entry (continuation lines indented to the message column), and
// OVD's own events as OVD lines:
//   07:27:00.257 E resmgr-app-registry         899 [AppRegistry] …
//   07:27:01.002 OVD Installed player_armv7.vpkg from the CLI
// `--json`: one JSON object per entry (JSON lines), never wrapped in a document:
//   {"time","level","priority","facility","process","pid","tid","tag","message","parsed"}
//   {"time","ovd","message"} for an OVD line (`ovd` is the event, with its `kind`)
// When reconnecting gives up (LOG_STREAM_ENDED) the output ends with the
// `{"ok":false,"error":…}` line, exit 1.
// `--export <file>` writes the lines to the file instead (`--format text`, the default, or
// `jsonl`, the `--json` line shape), refusing an existing file without `--force`. On stop:
// `Exported N lines to <file>`, or with `--json` one `{"ok":true,"path","format","lines"}`.

interface LogsOptions {
  app?: string
  system?: boolean
  level?: string
  since?: string
  until?: string
  grep?: string
  regex?: boolean
  // commander's `--no-restart-after-install`: false when given, true otherwise.
  restartAfterInstall?: boolean
  export?: string
  format?: LogExportFormat
  force?: boolean
}

// The level letter's color on a terminal; `ovd run` follows the log the same way.
export const LOG_COLORS: Record<LogEntry['level'], string> = {
  E: '\u001b[31m',
  W: '\u001b[33m',
  I: '\u001b[32m',
  D: '\u001b[36m'
}
export const LOG_COLOR_RESET = '\u001b[0m'

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
    .option('--no-restart-after-install', 'keep the stream running when OVD installs on the target')
    .option('--export <file>', 'write the lines to this file instead of printing them')
    .addOption(
      new Option('--format <format>', 'the --export file format (default: text)').choices(
        LOG_EXPORT_FORMATS
      )
    )
    .option('--force', 'replace the --export file when it exists')
    .action(async (opts: LogsOptions, cmd: Command) => {
      if (opts.export === undefined && (opts.format !== undefined || opts.force)) {
        cmd.error(`error: ${opts.format !== undefined ? '--format' : '--force'} needs --export`)
      }
      const ctx = reportContext(cmd, deps, setExitCode)
      const color = deps.stdoutTty === true && deps.env.NO_COLOR === undefined
      const paintLevel = color
        ? (level: LogEntry['level'], text: string) =>
            `${LOG_COLORS[level]}${text}${LOG_COLOR_RESET}`
        : undefined
      // Set with `--export`: the lines go to the file instead of stdout.
      let exported: LogExportWriter | undefined
      const print = (entries: LogEntry[]) => {
        if (entries.length === 0) return
        if (exported) {
          exported.write(entries)
          return
        }
        const text = ctx.json
          ? entries.map((entry) => `${JSON.stringify(logJson(entry))}\n`).join('')
          : entries.map((entry) => logText(entry, paintLevel ? { paintLevel } : {})).join('')
        deps.output.stdout(text)
      }

      const controller = new AbortController()
      const dispose = deps.onInterrupt(() => controller.abort())
      try {
        // Checked before the session starts: a file that can't be written starts no stream.
        if (opts.export !== undefined) {
          exported = await openLogExport(opts.export, {
            format: opts.format ?? 'text',
            overwrite: opts.force === true,
            // A failed write stops the session; `close()` then reports the error.
            onError: () => controller.abort()
          })
        }
        let session
        try {
          session = await deps.ovd().logs.start({
            ...(ctx.device === undefined ? {} : { device: ctx.device }),
            filter: filterOf(opts),
            restartAfterInstall: opts.restartAfterInstall !== false,
            signal: controller.signal,
            // The CLI prints and forgets: core keeps no buffer for it.
            capacity: 0,
            onEntries: print
          })
        } catch (error) {
          // No stream ran: no file is left behind, and an existing `--force` target is kept.
          await exported?.discard()
          // Ctrl+C before the first line is a normal stop.
          if (error instanceof Error && error.name === 'AbortError') return
          throw error
        }
        deps.output.stderr(
          exported
            ? `Exporting the log of ${session.target.name} to ${exported.path} (Ctrl+C to stop)…\n`
            : `Following the log of ${session.target.name} (Ctrl+C to stop)…\n`
        )
        const end = await session.done
        if (exported) {
          // Closed even when the stream gave up: the file keeps the lines that arrived.
          const result = await exported.close()
          if (end.reason === 'ended') reportError(ctx, end.error)
          else if (ctx.json) deps.output.stdout(`${JSON.stringify({ ok: true, ...result })}\n`)
          else deps.output.stdout(`Exported ${result.lines} lines to ${result.path}\n`)
          return
        }
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
