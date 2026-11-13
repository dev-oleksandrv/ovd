import type { LogExportFormat } from '@ovd/core'
import { useEffect, useRef, useState } from 'react'
import { targetDevice, useDevicesContext } from '../../devices/devicesContext'
import { useFeedback } from '../../feedback/feedbackContext'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorState } from '../../ui/ErrorState'
import { InlineError } from '../../ui/InlineError'
import { InlineNote } from '../../ui/InlineNote'
import { LoadingState } from '../../ui/LoadingState'
import { OfflineState } from '../../ui/OfflineState'
import { LogFooter } from './LogFooter'
import { LogList } from './LogList'
import { LogToolbar } from './LogToolbar'
import { newLines, visibleCount } from './logStore'
import {
  crashLogsOutcome,
  heldDevice,
  logsBlocker,
  logsCli,
  packageChoices,
  sessionLabel,
  type CrashLogsRequest
} from './logsView'
import { NO_LINES_TO_EXPORT, useLogs } from './useLogs'

interface LogsScreenProps {
  // Opens the title bar's target picker.
  onSwitchTarget: () => void
  // The open project's app ID, offered in the package filter before it logs anything.
  projectAppId: string | null
  // An export the palette asked for; `n` tells two requests for the same format apart. It
  // waits while the session starts, then runs once; `onExportHandled` clears it.
  exportRequest?: { format: LogExportFormat; n: number } | null
  onExportHandled?: () => void
  // "Logs at crash time": filter on the crash's app and show its time, or say why the buffer
  // can't. `onCrashRequestHandled` clears it.
  crashRequest?: CrashLogsRequest | null
  onCrashRequestHandled?: () => void
}

// Debug → Logs (Stage 3.1): the target's live log, filtered in core, with its `ovd logs` echo.
export function LogsScreen({
  onSwitchTarget,
  projectAppId,
  exportRequest = null,
  onExportHandled = () => undefined,
  crashRequest = null,
  onCrashRequestHandled = () => undefined
}: LogsScreenProps) {
  const { state: devices } = useDevicesContext()
  const { notify } = useFeedback()
  const target = targetDevice(devices)
  const blocker = logsBlocker(target)
  const logs = useLogs(target)
  const { store, filter } = logs
  const session = store.state
  // Without a target, the session main keeps while its device reconnects stays on screen.
  const held = heldDevice(session, target)
  const name = target?.name ?? (held !== null && session.status !== 'idle' ? session.name : '')
  // The session for the target decides first: a running or reconnecting one keeps the screen
  // while the target shows offline. An ended one on an offline target gives way to the offline
  // state, with why it ended: Restart can't work until the target is back.
  const forTarget =
    session.status !== 'idle' && session.device === (target?.id ?? held) ? session : null
  const endedOffline = blocker === 'offline' && forTarget?.status === 'ended' ? forTarget : null
  const current = endedOffline ? null : forTarget
  const shown = blocker === null || current !== null
  const count = visibleCount(store)
  const following = store.seenThrough === null
  const paused = store.pausedThrough !== null
  // A palette export: none without a session (no target, or an offline one), else once the
  // session for the target runs, reconnects or ended (main keeps its lines). It waits for the
  // first device list: until then there's no target to tell.
  const exportShown = logs.exportShown
  const exportStatus =
    devices.status === 'loading'
      ? null
      : blocker !== null && current === null
        ? 'none'
        : (current?.status ?? null)
  // The request last run: it runs once even if a render comes before the parent cleared it.
  const exportedRef = useRef<number | null>(null)
  useEffect(() => {
    if (exportRequest === null || exportStatus === null || exportStatus === 'starting') return
    if (exportedRef.current === exportRequest.n) return
    exportedRef.current = exportRequest.n
    onExportHandled()
    if (exportStatus === 'none') notify({ tone: 'info', text: NO_LINES_TO_EXPORT })
    else exportShown(exportRequest.format)
  }, [exportRequest, exportStatus, exportShown, onExportHandled, notify])

  // A crash request waits for the session like an export does, filters the buffer on the app,
  // then reads the re-filtered list: it scrolls to the crash's time when the session started
  // before it, else it says the journal rotates fast. An open session is kept as it is.
  const crashRef = useRef<number | null>(null)
  const [resolving, setResolving] = useState<CrashLogsRequest | null>(null)
  const [crashNote, setCrashNote] = useState<{ title: string; body: string } | null>(null)
  const [scrollTo, setScrollTo] = useState<{ n: number; index: number } | null>(null)
  const { showApp, setFollow } = logs
  useEffect(() => {
    if (crashRequest === null || exportStatus === null || exportStatus === 'starting') return
    if (crashRef.current === crashRequest.n) return
    crashRef.current = crashRequest.n
    onCrashRequestHandled()
    setCrashNote(null)
    if (exportStatus === 'none') return
    void showApp(crashRequest.app).then(() => setResolving(crashRequest))
  }, [crashRequest, exportStatus, showApp, onCrashRequestHandled])
  // Set during render (as in Shell): once per request, when its re-filtered buffer arrived.
  const [resolved, setResolved] = useState<number | null>(null)
  if (resolving !== null && resolved !== resolving.n) {
    setResolved(resolving.n)
    const startedAt = current && current.status !== 'starting' ? current.startedAt : null
    const outcome = crashLogsOutcome(
      resolving,
      { startedAt, lines: store.counts.lines },
      store.entries
    )
    if (outcome.kind === 'note') {
      setCrashNote(outcome)
    } else {
      setFollow(false)
      setScrollTo({ n: resolving.n, index: outcome.index })
    }
  }

  const restartButton = (
    <Button icon="restart_alt" onClick={logs.restart}>
      Restart
    </Button>
  )

  const list = (
    <LogList
      entries={store.entries}
      count={count}
      search={filter.search ?? ''}
      regex={filter.regex === true}
      follow={following && !paused}
      onFollowChange={logs.setFollow}
      onSeenBottom={logs.seenBottom}
      scrollTo={scrollTo}
    />
  )

  const body =
    blocker === 'no-target' && !current ? (
      <EmptyState
        title="No target device"
        body="Pick a device in the title bar to follow its log."
        actions={<Button onClick={onSwitchTarget}>Choose a target</Button>}
      />
    ) : blocker === 'offline' && !current ? (
      <OfflineState
        deviceName={name}
        title="Logs unavailable"
        {...(endedOffline
          ? { detail: `The last log session ended: ${endedOffline.error.message}` }
          : {})}
        actions={<Button onClick={onSwitchTarget}>Switch target</Button>}
      />
    ) : !current || current.status === 'starting' ? (
      <LoadingState label={`Starting the log session on ${name}…`} />
    ) : current.status === 'ended' && store.counts.lines === 0 && store.entries.length === 0 ? (
      <ErrorState
        title={current.error.message}
        hint={current.error.hint}
        command={logsCli(filter, current.device, current.restartAfterInstall)}
        actions={restartButton}
      />
    ) : (current.status === 'running' || current.status === 'reconnecting') &&
      store.counts.lines === 0 &&
      store.entries.length === 0 ? (
      <EmptyState
        title={`Waiting for log lines from ${name}`}
        body="Lines show up here as the device logs them."
      />
    ) : store.counts.lines > 0 && store.entries.length === 0 ? (
      <EmptyState
        title="No lines match the filters"
        body={`${store.counts.lines} lines arrived; none of them match the level, package or search.`}
        actions={<Button onClick={logs.clearFilters}>Clear filters</Button>}
      />
    ) : (
      list
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-1 border-b border-line px-6 pt-5 pb-4">
        <h1 className="m-0 text-heading font-semibold tracking-[-0.015em]">Logs</h1>
        <div className="text-muted">
          {name ? `Live log of ${name} · filtered on this computer` : 'The target’s live log'}
        </div>
      </header>
      {shown && (
        <LogToolbar
          label={current ? sessionLabel(current) : name}
          filter={filter}
          packages={packageChoices(
            filter.app ? [...store.apps, filter.app] : store.apps,
            projectAppId
          )}
          search={logs.search}
          regex={logs.regex}
          regexError={logs.regexError}
          paused={paused}
          onSearch={logs.setSearch}
          onRegex={logs.setRegex}
          onLevel={logs.setLevel}
          onPackage={logs.setPackage}
          onPause={logs.pause}
          onResume={logs.resume}
          onClear={logs.clear}
          onExport={logs.exportShown}
        />
      )}
      {current?.status === 'reconnecting' && (
        <div className="px-6 pt-3">
          <InlineNote
            title={`Reconnecting to ${current.name}…`}
            body="The device dropped. Lines continue here once it’s back."
          />
        </div>
      )}
      {crashNote && (
        <div className="px-6 pt-3">
          <InlineNote title={crashNote.title} body={crashNote.body} />
        </div>
      )}
      {current?.status === 'ended' && store.entries.length > 0 && (
        <div className="px-6 pt-3">
          <InlineError title={current.error.message} body={current.error.hint}>
            <div>{restartButton}</div>
          </InlineError>
        </div>
      )}
      {body}
      {current && current.status !== 'starting' && (
        <LogFooter
          counts={store.counts}
          newLines={newLines(store)}
          follow={following && !paused}
          onFollow={(on) => {
            logs.setFollow(on)
            if (on) logs.resume()
          }}
          onShowNew={() => {
            logs.setFollow(true)
            logs.resume()
          }}
          restartAfterInstall={logs.restartAfterInstall}
          onRestartAfterInstall={logs.setRestartAfterInstall}
        />
      )}
    </div>
  )
}
