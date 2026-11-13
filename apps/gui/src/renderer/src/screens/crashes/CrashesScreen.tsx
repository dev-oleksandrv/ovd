import type { Crash } from '@ovd/core'
import { useEffect, useState } from 'react'
import { targetDevice, useDevicesContext } from '../../devices/devicesContext'
import { useFeedback } from '../../feedback/feedbackContext'
import { Button } from '../../ui/Button'
import { InlineError } from '../../ui/InlineError'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorState } from '../../ui/ErrorState'
import { LoadingState } from '../../ui/LoadingState'
import { OfflineState } from '../../ui/OfflineState'
import { crashKey, markSeen, useNewCrashIds } from './crashNew'
import { CrashDetailPanel } from './CrashDetailPanel'
import { CrashTable } from './CrashTable'
import { CRASHES_SUBTITLE, crashesBlocker, crashesCli } from './crashesView'
import { useCrashes } from './useCrashes'

// A crash the toast or Apps asked to open; `n` tells two requests for one crash apart.
export interface OpenCrashRequest {
  device: string
  id: number
  n: number
}

interface CrashesScreenProps {
  // Opens the title bar's target picker.
  onSwitchTarget: () => void
  openRequest?: OpenCrashRequest | null
  onOpenHandled?: () => void
  onOpenLogs: (crash: Crash) => void
}

// Debug → Crashes (Stage 5.1): the crash reports of the developer's apps on the target, from
// `loggingctl vault`, with their stack and the actions on them.
export function CrashesScreen({
  onSwitchTarget,
  openRequest = null,
  onOpenHandled = () => undefined,
  onOpenLogs
}: CrashesScreenProps) {
  const { echo } = useFeedback()
  const { state: devices } = useDevicesContext()
  const target = targetDevice(devices)
  const blocker = crashesBlocker(target)
  const device = blocker === null && target ? target.id : null
  const { state, reload } = useCrashes(device)
  const newIds = useNewCrashIds()
  // The detail belongs to the device it was opened on.
  const [selected, setSelected] = useState<{ device: string; id: number } | null>(null)
  // The last "Open" request looked at (`n`).
  const [handled, setHandled] = useState<number | null>(null)
  const name = target?.name ?? ''

  useEffect(() => {
    if (device !== null) echo(crashesCli(device))
  }, [device, echo])

  const list = 'list' in state && state.list?.device === device ? state.list : undefined
  const crashes = list?.crashes ?? []
  const current =
    selected !== null && selected.device === device
      ? crashes.find((c) => c.id === selected.id)
      : undefined

  // An "Open" from the toast or from Apps: looked at once, against a list that no refresh is
  // about to replace (the crash it names may only be in the refreshed one). Set during render
  // (as in Shell) so the detail never flashes the wrong state.
  if (openRequest !== null && device !== null && handled !== openRequest.n) {
    if (openRequest.device !== device) {
      setHandled(openRequest.n)
    } else if (list && state.status !== 'loading') {
      setHandled(openRequest.n)
      const found = list.crashes.find((c) => c.id === openRequest.id)
      if (found) setSelected({ device, id: found.id })
    }
  }
  useEffect(() => {
    if (openRequest !== null && handled === openRequest.n) onOpenHandled()
  }, [openRequest, handled, onOpenHandled])

  // Opening a crash's detail clears its NEW.
  const currentId = current?.id
  useEffect(() => {
    if (device !== null && currentId !== undefined) markSeen(device, currentId)
  }, [device, currentId])

  const select = (crash: Crash): void => {
    if (device !== null) setSelected({ device, id: crash.id })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-1 border-b border-line px-6 pt-5 pb-4">
        <h1 className="m-0 text-heading font-semibold tracking-[-0.015em]">Crashes</h1>
        <div className="text-muted">{CRASHES_SUBTITLE}</div>
      </header>
      {blocker === 'no-target' ? (
        <EmptyState
          title="No target device"
          body="Pick a device in the title bar to see its crashes."
          actions={<Button onClick={onSwitchTarget}>Choose a target</Button>}
        />
      ) : blocker === 'offline' ? (
        <OfflineState
          deviceName={name}
          title="Crashes unavailable"
          actions={<Button onClick={onSwitchTarget}>Switch target</Button>}
        />
      ) : !list && state.status === 'error' ? (
        <ErrorState
          title={state.error.message}
          hint={state.error.hint}
          {...(device === null ? {} : { command: crashesCli(device) })}
        />
      ) : !list ? (
        <LoadingState label={`Reading crashes on ${name}…`} />
      ) : (
        <>
          {state.status === 'error' && (
            <div className="px-6 pt-4">
              <InlineError title={state.error.message} body={state.error.hint}>
                <div>
                  <Button onClick={() => void reload()}>Retry</Button>
                </div>
              </InlineError>
            </div>
          )}
          {crashes.length === 0 ? (
            <EmptyState
              title={`No crashes of your apps on ${name}`}
              body="A crash of an app you installed shows up here, with a toast, as it happens."
            />
          ) : (
            <div
              className={
                current
                  ? 'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(320px,460px)]'
                  : 'grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)]'
              }
            >
              <div className="overflow-auto">
                <CrashTable
                  crashes={crashes}
                  deviceName={name}
                  now={new Date()}
                  isNew={(c) => device !== null && newIds.has(crashKey(device, c.id))}
                  selectedId={current?.id ?? null}
                  onSelect={select}
                />
              </div>
              {current && device !== null && (
                <CrashDetailPanel
                  key={`${device}\n${current.id}`}
                  crash={current}
                  device={device}
                  now={new Date()}
                  onOpenLogs={onOpenLogs}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
