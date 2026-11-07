import type { InstalledApp } from '@ovd/core'
import { useEffect, useState } from 'react'
import { targetDevice, useDevicesContext } from '../../devices/devicesContext'
import { useFeedback } from '../../feedback/feedbackContext'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorState } from '../../ui/ErrorState'
import { LoadingState } from '../../ui/LoadingState'
import { OfflineState } from '../../ui/OfflineState'
import { StatusPill } from '../../ui/StatusPill'
import { Table, type Column } from '../../ui/Table'
import { Tabs } from '../../ui/Tabs'
import { AppAvatar } from './AppAvatar'
import type { ReinstallPackage } from './AppActions'
import { AppDetail } from './AppDetail'
import {
  appInfoCli,
  appsBlocker,
  appsCli,
  canUninstall,
  statusView,
  tabCounts,
  visibleApps,
  withDetail,
  type AppAction,
  type AppTab
} from './appsView'
import { RowAction } from './RowAction'
import { useAppActions } from './useAppActions'
import { useApps } from './useApps'

interface AppsScreenProps {
  // Opens the title bar's target picker.
  onSwitchTarget: () => void
  onGoPackages: () => void
  // The open project folder or .vpkg: what "Uninstall & reinstall" installs from.
  projectPath: string | null
}

// The table's columns; the last one holds each row's Launch / Stop.
function appColumns(
  busy: Readonly<Record<string, AppAction>>,
  onAction: (action: AppAction, app: InstalledApp) => void
): Array<Column<InstalledApp>> {
  return [
    {
      key: 'app',
      header: 'App',
      width: 'minmax(0,2.2fr)',
      render: (a) => (
        <div className="flex min-w-0 items-center gap-3">
          <AppAvatar packageId={a.packageId} title={a.title} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="truncate font-semibold">{a.title}</div>
            <div className="truncate font-mono text-label text-muted">{a.packageId}</div>
          </div>
        </div>
      )
    },
    {
      key: 'version',
      header: 'Version',
      width: '90px',
      render: (a) => <span className="font-mono text-small text-text-soft">{a.version || '—'}</span>
    },
    {
      key: 'status',
      header: 'Status',
      width: '140px',
      render: (a) => {
        const s = statusView(a)
        return <StatusPill tone={s.tone}>{s.label}</StatusPill>
      }
    },
    {
      key: 'action',
      header: '',
      width: '90px',
      align: 'right',
      render: (a) => <RowAction app={a} busy={busy[a.packageId]} onAction={onAction} />
    }
  ]
}

// Apps (Stage 2.4): the side-loaded and Appstore apps on the target, what runs, and the actions
// on them. Each action echoes its `ovd apps …` and reloads the list when it is done.
export function AppsScreen({ onSwitchTarget, onGoPackages, projectPath }: AppsScreenProps) {
  const { echo } = useFeedback()
  const { state: devices } = useDevicesContext()
  const target = targetDevice(devices)
  const blocker = appsBlocker(target)
  const device = blocker === null && target ? target.id : null
  const { state, reload } = useApps(device)
  const { busy, run } = useAppActions(device, reload)
  const [tab, setTab] = useState<AppTab>('installed')
  const [selected, setSelected] = useState<string | null>(null)
  // Component details (`vpm info` per component), by package ID and update time.
  const [details, setDetails] = useState<Record<string, InstalledApp>>({})

  useEffect(() => {
    if (device !== null) echo(appsCli(device))
  }, [device, echo])

  const list = 'list' in state ? state.list : undefined
  const apps = list && list.target.id === device ? list.apps : []
  const shown = visibleApps(apps, tab)
  const current = shown.find((a) => a.packageId === selected) ?? shown[0]
  const detailKey = current ? `${device}\n${current.packageId}\n${current.updatedAt}` : null
  const detail = detailKey ? details[detailKey] : undefined

  useEffect(() => {
    if (detailKey === null || device === null || !current || detail) return
    let live = true
    void window.ovd.apps.info(current.packageId, device).then((result) => {
      // A failed read isn't shown: the list already has what the detail needs most.
      if (live && result.ok) setDetails((all) => ({ ...all, [detailKey]: result.data.app }))
    })
    return () => {
      live = false
    }
  }, [detailKey, device, current, detail])

  // The package "Uninstall & reinstall" would install, looked up again after every list read
  // (`list` changes then), so a build made since shows up. The last answer stays meanwhile.
  const resolveId = current && canUninstall(current) ? current.packageId : null
  const resolveKey =
    resolveId !== null && device !== null ? `${device}\n${resolveId}\n${projectPath ?? ''}` : null
  const [reinstall, setReinstall] = useState<{ key: string; value: ReinstallPackage } | null>(null)
  useEffect(() => {
    if (resolveKey === null || resolveId === null || device === null || !list) return
    let live = true
    void window.ovd.install.resolve(resolveId, device).then((result) => {
      if (!live) return
      setReinstall({
        key: resolveKey,
        value: result.ok
          ? { ok: true, file: result.data.file }
          : { ok: false, reason: result.error.message }
      })
    })
    return () => {
      live = false
    }
  }, [resolveKey, resolveId, device, list])
  const reinstallPackage = reinstall?.key === resolveKey ? reinstall.value : undefined

  const select = (app: InstalledApp): void => {
    setSelected(app.packageId)
    if (device !== null) echo(appInfoCli(app.packageId, device))
  }

  const counts = tabCounts(apps)
  const name = target?.name ?? ''
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-line px-6 pt-5">
        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1">
            <h1 className="m-0 text-heading font-semibold tracking-[-0.015em]">Apps</h1>
            <div className="text-muted">
              {target
                ? `On ${name} · launches are verified against running-apps and crash history`
                : 'Launches are verified against running-apps and crash history'}
            </div>
          </div>
          <Tabs
            items={[
              { id: 'installed', label: `Installed · ${counts.installed}` },
              { id: 'running', label: `Running · ${counts.running}` }
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
      </header>
      {blocker === 'no-target' ? (
        <EmptyState
          title="No target device"
          body="Pick a device in the title bar to see its apps."
          actions={<Button onClick={onSwitchTarget}>Choose a target</Button>}
        />
      ) : blocker === 'offline' ? (
        <OfflineState
          deviceName={name}
          title="Apps unavailable"
          actions={<Button onClick={onSwitchTarget}>Switch target</Button>}
        />
      ) : !list && state.status === 'error' ? (
        <ErrorState
          title={state.error.message}
          hint={state.error.hint}
          {...(device === null ? {} : { command: appsCli(device) })}
        />
      ) : !list ? (
        <LoadingState label={`Reading apps on ${name}…`} />
      ) : apps.length === 0 ? (
        <EmptyState
          title={`No apps you installed on ${name}`}
          body="Install a build from Packages, or with ovd apps install <file.vpkg>."
          actions={<Button onClick={onGoPackages}>Go to Packages</Button>}
        />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
          <div className="overflow-auto">
            <Table
              columns={appColumns(busy, (action, app) => void run(action, app))}
              rows={shown}
              rowKey={(a) => a.packageId}
              {...(current ? { selectedKey: current.packageId } : {})}
              onSelect={select}
            />
            {shown.length === 0 && (
              <div className="px-6 py-10 text-center text-muted">
                Nothing running on this device.
              </div>
            )}
          </div>
          {current && (
            <AppDetail
              app={withDetail(current, detail)}
              now={new Date()}
              busy={busy[current.packageId]}
              onAction={(action, app) => void run(action, app)}
              reinstall={reinstallPackage}
            />
          )}
        </div>
      )}
    </div>
  )
}
