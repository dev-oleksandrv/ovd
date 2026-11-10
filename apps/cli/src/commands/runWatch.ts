import {
  launchNotVerified,
  toErrorJson,
  type BuildChange,
  type LogEntry,
  type LogSession,
  type OvdError,
  type RunStep,
  type WatchFolder
} from '@ovd/core'
import { notVerifiedText } from '../format/appActions.js'
import { forcedWarning } from '../format/install.js'
import { runLines, runStepLine } from '../format/run.js'
import type { CliDeps, GlobalOptions } from '../program.js'
import { reportError, type ReportContext } from '../report.js'

// A session restarts within about a second of an install (the activity feed's 500 ms tail,
// then the stream's start); past this, a redeploy goes on without waiting, as the desktop's.
export const FOLLOW_TIMEOUT_MS = 15_000

export interface RunWatchOptions {
  app: string | undefined
  force: boolean
  ctx: ReportContext & GlobalOptions
  // The log lines as `ovd run` prints them (JSON lines or the human format).
  format: (entries: LogEntry[]) => string
}

// `ovd run --watch [app]` (Stage 3.5): watches the project's `build/` folder, runs once, then
// redeploys every new build that fits the target, until Ctrl+C (exit 0) or the log stream gives
// up (exit 1). No run result ends it: each run, the first and every redeploy, prints its
// document (`{"ok":true,"run":…}` or `{"ok":false,"error":…}`) and watching goes on, with the
// log session kept running. Runs go one at a time: a build that settles during a run is
// redeployed after it. A redeploy installs, so the running session restarts (ADR 0014) and the
// redeploy waits for that before it launches; without a session it starts one.
export async function runWatch(deps: CliDeps, opts: RunWatchOptions): Promise<void> {
  const { ctx, format } = opts
  const out = deps.output
  // Per-run failures print as `reportError` does, but don't set the exit code: watching goes on.
  const quiet: ReportContext = { ...ctx, setExitCode: () => undefined }
  const ovd = deps.ovd()

  let folder: WatchFolder
  try {
    folder = await ovd.watch.folder(opts.app)
  } catch (error) {
    reportError(ctx, error)
    return
  }

  // The first run's lines wait until its document is printed; `undefined` once it is.
  let held: LogEntry[] | undefined = []
  const print = (entries: LogEntry[]) => {
    if (entries.length === 0) return
    if (held) held.push(...entries)
    else out.stdout(format(entries))
  }
  const release = () => {
    const waiting = held ?? []
    held = undefined
    print(waiting)
  }

  const controller = new AbortController()
  let finish = (_end: { error?: OvdError }): void => undefined
  const finished = new Promise<{ error?: OvdError }>((resolve) => (finish = resolve))
  const dispose = deps.onInterrupt(() => {
    controller.abort()
    finish({})
  })

  let session: LogSession | undefined
  let live = false
  // The restart the current run's install causes; set at its `install` step.
  let restarted: Promise<void> | undefined
  let onRestart = (): void => undefined
  let announced = false

  const startSession = async (device: string) => {
    const started = await ovd.logs.start({
      device,
      signal: controller.signal,
      // The CLI prints and forgets: core keeps no buffer for it.
      capacity: 0,
      onEntries: print,
      onRestart: (reason) => {
        if (reason === 'install') onRestart()
      }
    })
    session = started
    live = true
    void started.done.then((end) => {
      live = false
      if (end.reason === 'ended') finish({ error: end.error })
    })
  }

  // A redeploy's log step: the restart its install causes, or FOLLOW_TIMEOUT_MS. Ctrl+C and the
  // session ending end the wait at once; on Ctrl+C the run then stops after this step
  // (AbortError), before its launch.
  const restartOf = async (waiting: Promise<void>, running: LogSession): Promise<void> => {
    const { signal } = controller
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort = (): void => undefined
    try {
      await Promise.race([
        waiting,
        running.done.then(() => undefined),
        new Promise<void>((resolve) => (timer = setTimeout(resolve, FOLLOW_TIMEOUT_MS))),
        new Promise<void>((resolve) => {
          onAbort = resolve
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', onAbort, { once: true })
        })
      ])
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      onRestart = () => undefined
    }
    if (signal.aborted) throw abortError()
  }

  const runOnce = async (ref: string, device: string | undefined, first: boolean) => {
    try {
      const result = await ovd.run.run(ref, {
        ...(device === undefined ? {} : { device }),
        ...(opts.force ? { force: true } : {}),
        signal: controller.signal,
        onStep: (step: RunStep) => {
          // Armed before the install: the session may restart before the run's log step.
          if (step.step === 'install' && live) {
            restarted = new Promise<void>((resolve) => (onRestart = resolve))
          }
          const line = runStepLine(step)
          if (line) out.stderr(line)
        },
        followLogs: async (target) => {
          const waiting = restarted
          restarted = undefined
          if (live && waiting && session) {
            await restartOf(waiting, session)
            return
          }
          if (!live) await startSession(target.id)
        }
      })
      if (result.forced) out.stderr(forcedWarning(result))
      const failed = launchNotVerified(result.launch)
      if (failed) {
        if (ctx.json) {
          out.stdout(`${JSON.stringify({ ok: false, error: toErrorJson(failed), run: result })}\n`)
        } else {
          out.stderr(notVerifiedText(result.launch, failed))
        }
      } else {
        out.stdout(ctx.json ? `${JSON.stringify({ ok: true, run: result })}\n` : runLines(result))
        if (!announced) {
          announced = true
          out.stderr(`Following the log of ${result.target.name} (Ctrl+C to stop)…\n`)
        }
      }
    } catch (error) {
      // Ctrl+C during a run: the run stops after the step in flight, the command ends.
      if (error instanceof Error && error.name === 'AbortError') return
      reportError(quiet, error)
    } finally {
      onRestart = () => undefined
      restarted = undefined
      if (first) release()
    }
  }

  // One run at a time: the first run and every redeploy go through this chain.
  let chain: Promise<void> = Promise.resolve()
  const enqueue = (job: () => Promise<void>): Promise<void> => {
    const next = chain.then(job)
    chain = next.catch(() => undefined)
    return next
  }

  const onBuild = (change: BuildChange): Promise<void> =>
    enqueue(async () => {
      if (controller.signal.aborted) return
      const shown = change.build ?? change.changed[0]
      const where = shown ? `${shown.folder}${shown.file}` : 'build/'
      if (change.error) {
        out.stderr(`Build changed: ${where}\n`)
        reportError(quiet, change.error)
        return
      }
      if (!change.build || !change.target) {
        out.stderr(`Build changed: ${where}, no build for ${change.target?.name ?? 'the target'}\n`)
        return
      }
      out.stderr(`Build changed: ${where}, redeploying…\n`)
      await runOnce(change.build.path, change.target.id, false)
    })

  try {
    // The CLI always names the folder it resolved, so its watch never follows another project.
    const watch = await ovd.watch.start(folder.path, {
      ...(ctx.device === undefined ? {} : { device: ctx.device }),
      signal: controller.signal,
      onBuild
    })
    out.stderr('Watching build/ for new builds (Ctrl+C to stop)…\n')
    void enqueue(() => runOnce(folder.path, ctx.device, true))
    const end = await finished
    controller.abort()
    watch.stop()
    await chain
    await session?.stop()
    if (end.error) reportError(ctx, end.error)
  } catch (error) {
    controller.abort()
    await session?.stop()
    reportError(ctx, error)
  } finally {
    dispose()
  }
}

function abortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}
