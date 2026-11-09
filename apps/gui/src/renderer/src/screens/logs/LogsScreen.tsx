import { targetDevice, useDevicesContext } from '../../devices/devicesContext'
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
import { logsBlocker, logsCli, packageChoices, sessionLabel } from './logsView'
import { useLogs } from './useLogs'

interface LogsScreenProps {
  // Opens the title bar's target picker.
  onSwitchTarget: () => void
  // The open project's app ID, offered in the package filter before it logs anything.
  projectAppId: string | null
}

// Debug → Logs (Stage 3.1): the target's live log, filtered in core, with its `ovd logs` echo.
export function LogsScreen({ onSwitchTarget, projectAppId }: LogsScreenProps) {
  const { state: devices } = useDevicesContext()
  const target = targetDevice(devices)
  const blocker = logsBlocker(target)
  const logs = useLogs(target)
  const { store, filter } = logs
  const name = target?.name ?? ''
  const session = store.state
  // The session for the target decides first: a running, reconnecting or ended one keeps the
  // screen while the target shows offline; the offline state is only for no session.
  const current = session.status !== 'idle' && session.device === target?.id ? session : null
  const shown = blocker === null || current !== null
  const count = visibleCount(store)
  const following = store.seenThrough === null
  const paused = store.pausedThrough !== null
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
    />
  )

  const body =
    blocker === 'no-target' ? (
      <EmptyState
        title="No target device"
        body="Pick a device in the title bar to follow its log."
        actions={<Button onClick={onSwitchTarget}>Choose a target</Button>}
      />
    ) : blocker === 'offline' && !current ? (
      <OfflineState
        deviceName={name}
        title="Logs unavailable"
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
          {target ? `Live log of ${name} · filtered on this computer` : 'The target’s live log'}
        </div>
      </header>
      {shown && (
        <LogToolbar
          label={current ? sessionLabel(current) : name}
          filter={filter}
          packages={packageChoices(store.apps, projectAppId)}
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
