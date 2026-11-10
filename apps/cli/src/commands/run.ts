import type { Command } from 'commander'
import {
  launchNotVerified,
  logJson,
  logText,
  toErrorJson,
  type LogEntry,
  type LogSession,
  type RunOutcome,
  type RunStep
} from '@ovd/core'
import { exitCodeFor } from '../exitCodes.js'
import { notVerifiedText } from '../format/appActions.js'
import { forcedWarning } from '../format/install.js'
import { runLines, runStepLine } from '../format/run.js'
import type { CliDeps } from '../program.js'
import { reportError } from '../report.js'
import { LOG_COLORS, LOG_COLOR_RESET } from './logs.js'
import { reportContext } from './context.js'
import { runWatch } from './runWatch.js'

interface RunFlags {
  force?: boolean
  watch?: boolean
}

// `ovd run [app]` (Stage 3.4): installs the build that matches the target (release for sticks,
// debug for the Virtual Device, ADR 0008), starts the log session, restarts the app, verifies
// the launch (ADR 0012), then follows the log as `ovd logs` does until Ctrl+C (exit 0) or the
// stream gives up (exit 1). Progress goes to stderr.
// `--json`: JSON lines (a stream, ADR 0006). The first is the run,
//   {"ok":true,"run":{"target","package","forced","launch"}}
// then the `ovd logs --json` lines. Log lines that arrive before the launch is verified are
// held and printed right after the run, so the run is always the first line. A failed run is
// one `{"ok":false,"error":…}` line (with `"run"` for an unverified launch, exit 7), its held
// lines dropped and its session stopped. Ctrl+C before the launch is verified stops the run
// after the step in flight and exits 0 with nothing on stdout.
// `--watch`: redeploys every new build of the project folder (`runWatch.ts`).
export function registerRun(
  program: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  program
    .command('run')
    .description('Install the build for the target, launch it and follow its log (Ctrl+C to stop)')
    .argument('[app]', '.vpkg, project folder or package ID (default: the open .vpkg or project)')
    .option('--force', 'install even when the package and target architectures differ')
    .option('--watch', 'redeploy every new build of the project folder (Ctrl+C to stop)')
    .action(async (app: string | undefined, opts: RunFlags, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      const color = deps.stdoutTty === true && deps.env.NO_COLOR === undefined
      const paintLevel = color
        ? (level: LogEntry['level'], text: string) =>
            `${LOG_COLORS[level]}${text}${LOG_COLOR_RESET}`
        : undefined
      const format = (entries: LogEntry[]) =>
        ctx.json
          ? entries.map((entry) => `${JSON.stringify(logJson(entry))}\n`).join('')
          : entries.map((entry) => logText(entry, paintLevel ? { paintLevel } : {})).join('')
      if (opts.watch) {
        await runWatch(deps, { app, force: opts.force === true, ctx, format })
        return
      }
      // Lines that arrive before the run is printed wait here; `undefined` once it is.
      let held: LogEntry[] | undefined = []
      // Set once the run fails or is aborted: lines the stream still delivers (while its session
      // stops) are dropped, so stdout carries only the error document, or nothing.
      let dropping = false
      const print = (entries: LogEntry[]) => {
        if (entries.length === 0 || dropping) return
        if (held) held.push(...entries)
        else deps.output.stdout(format(entries))
      }

      const controller = new AbortController()
      const dispose = deps.onInterrupt(() => controller.abort())
      let session: LogSession | undefined
      try {
        let result: RunOutcome
        try {
          result = await deps.ovd().run.run(app, {
            ...(ctx.device === undefined ? {} : { device: ctx.device }),
            ...(opts.force ? { force: true } : {}),
            signal: controller.signal,
            onStep: (step: RunStep) => {
              const line = runStepLine(step)
              if (line) deps.output.stderr(line)
            },
            followLogs: async (target) => {
              session = await deps.ovd().logs.start({
                device: target.id,
                signal: controller.signal,
                // The CLI prints and forgets: core keeps no buffer for it.
                capacity: 0,
                onEntries: print
              })
            }
          })
        } catch (error) {
          dropping = true
          await session?.stop()
          // Ctrl+C before the launch is verified is a normal stop.
          if (error instanceof Error && error.name === 'AbortError') return
          throw error
        }
        if (result.forced) deps.output.stderr(forcedWarning(result))
        const failed = launchNotVerified(result.launch)
        if (failed) {
          // The crash's own lines are in `launch.crash.logs`; the held ones are dropped.
          dropping = true
          await session?.stop()
          if (ctx.json) {
            const doc = { ok: false, error: toErrorJson(failed), run: result }
            deps.output.stdout(`${JSON.stringify(doc)}\n`)
          } else {
            deps.output.stderr(notVerifiedText(result.launch, failed))
          }
          setExitCode(exitCodeFor(failed.code))
          return
        }
        deps.output.stdout(
          ctx.json ? `${JSON.stringify({ ok: true, run: result })}\n` : runLines(result)
        )
        deps.output.stderr(`Following the log of ${result.target.name} (Ctrl+C to stop)…\n`)
        const waiting = held ?? []
        held = undefined
        print(waiting)
        if (!session) return
        const end = await session.done
        if (end.reason === 'ended') reportError(ctx, end.error)
      } catch (error) {
        reportError(ctx, error)
      } finally {
        dispose()
      }
    })
}
