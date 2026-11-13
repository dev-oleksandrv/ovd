import {
  OvdError,
  escapeControls,
  isOvdError,
  toErrorJson,
  type Crash,
  type CrashWatchOptions
} from '@ovd/core'
import type { Command } from 'commander'
import {
  crashLine,
  crashesTable,
  noteJson,
  noteMessage,
  noteText,
  pulledLine,
  type WatchNote
} from '../format/crashes.js'
import type { CliDeps } from '../program.js'
import { report, reportError } from '../report.js'
import { reportContext } from './context.js'

// `ovd crashes [--watch]` and `ovd crash pull <id>` (Stage 5.1): the crash reports of the
// developer's apps on the target (`loggingctl vault`, scoped to the side-loaded apps installed
// there). A crash's id is its vault index; `ovd crashes` shows it.
//
// `ovd crashes --json`: `{"ok":true,"device","crashes":[{"id","package","kind","signal","pid",
// "time","version","build","summary","new"}]}`.
// `--watch` prints the list, then every report that appears (polling every 5 s) until Ctrl+C,
// which exits 0. `--watch --json` prints JSON lines: the list document, then one
// `{"ok":true,"crash":{…}}` per new report, and OVD lines in the shape `ovd logs --json` uses
// (`{"time","ovd":{"kind"},"message"}`) when the target goes away and comes back; polling goes on
// silently meanwhile. A poll that fails (an unreadable listing) goes to stderr, in both modes.
// `ovd crash pull <id> --json`: `{"ok":true,"crash":{…},"path","bytes"}`.
// Human output shows control characters of device text as visible escapes, as `ovd logs` does.

interface CrashesFlags {
  watch?: boolean
}

interface PullFlags {
  out?: string
  force?: boolean
}

export function registerCrashes(
  program: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  program
    .command('crashes')
    .description('List the crash reports of your apps on the target')
    .option('--watch', 'keep running and print new crash reports as they appear (Ctrl+C to stop)')
    .action(async (flags: CrashesFlags, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      const device = ctx.device === undefined ? {} : { device: ctx.device }

      if (!flags.watch) {
        await report(ctx, () => deps.ovd().crashes.list(ctx.device), {
          json: (list) => list,
          human: (list) => crashesTable(list)
        })
        return
      }

      const write = (value: object) => deps.output.stdout(`${JSON.stringify(value)}\n`)
      const note = (kind: WatchNote, who: { name: string } | undefined) => {
        const message = noteMessage(kind, who)
        const time = new Date().toISOString()
        deps.output.stdout(
          ctx.json
            ? `${JSON.stringify(noteJson(kind, message, time))}\n`
            : noteText(kind, message, time)
        )
      }
      const controller = new AbortController()
      const dispose = deps.onInterrupt(() => controller.abort())
      try {
        // The list is the baseline: core announces only what appears after it.
        const list = await deps.ovd().crashes.list(ctx.device)
        if (controller.signal.aborted) return
        deps.output.stdout(
          ctx.json ? `${JSON.stringify({ ok: true, ...list })}\n` : crashesTable(list)
        )
        const watchOpts: CrashWatchOptions = {
          ...device,
          onNew: (crash: Crash) =>
            ctx.json ? write({ ok: true, crash }) : deps.output.stdout(crashLine(crash)),
          onAway: (who) => note('away', who),
          onBack: (who) => note('back', who),
          onError: (error) => {
            const body = isOvdError(error)
              ? toErrorJson(error)
              : { message: error.message, hint: undefined }
            // Error text can carry device output: shown as visible escapes, also in JSON mode.
            deps.output.stderr(
              escapeControls(`Error: ${body.message}${body.hint ? `\n${body.hint}` : ''}\n`)
            )
          }
        }
        const watch = deps.ovd().crashes.watch(watchOpts)
        deps.output.stderr(
          `Watching ${escapeControls(list.device)} for crashes (Ctrl+C to stop)…\n`
        )
        await new Promise<void>((resolve) => {
          if (controller.signal.aborted) resolve()
          controller.signal.addEventListener('abort', () => resolve(), { once: true })
        })
        watch.stop()
      } catch (error) {
        reportError(ctx, error)
      } finally {
        dispose()
      }
    })

  program
    .command('crash')
    .description('Work with one crash report')
    .command('pull')
    .description('Save the whole crash report (.acr) of a crash from `ovd crashes`')
    .argument('<id>', 'the crash’s id: the number `ovd crashes` shows')
    .option('--out <path>', 'a .acr file or a folder (default: ~/ovd/crashes)')
    .option('--force', 'replace the --out file if it exists')
    .action(async (id: string, flags: PullFlags, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      await report(
        ctx,
        async () => {
          const controller = new AbortController()
          const dispose = deps.onInterrupt(() => controller.abort())
          try {
            return await deps.ovd().crashes.pull({
              id,
              ...(ctx.device === undefined ? {} : { device: ctx.device }),
              ...(flags.out === undefined ? {} : { out: flags.out }),
              force: flags.force ?? false,
              signal: controller.signal
            })
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              throw new OvdError('COMMAND_FAILED', 'Cancelled', 'Nothing was saved')
            }
            throw error
          } finally {
            dispose()
          }
        },
        { json: (result) => result, human: pulledLine }
      )
    })
}
