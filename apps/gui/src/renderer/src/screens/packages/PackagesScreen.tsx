import type { ArchCheck, ErrorJson, PackageBuild, PackageInfo } from '@ovd/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { IpcResult } from '../../../../preload/api'
import { targetDevice, useDevicesContext } from '../../devices/devicesContext'
import { useFeedback } from '../../feedback/feedbackContext'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorState } from '../../ui/ErrorState'
import { LoadingState } from '../../ui/LoadingState'
import { BuildRow } from './BuildRow'
import { DropZone } from './DropZone'
import { PackageDetail } from './PackageDetail'
import { infoCli, inspectedBuild, installBlocker, installCli } from './packagesView'

type Builds =
  | { status: 'loading' }
  | { status: 'ready'; builds: PackageBuild[] }
  | { status: 'error'; error: ErrorJson }
type Read = { status: 'ready'; info: PackageInfo } | { status: 'error'; error: ErrorJson }

interface PackagesScreenProps {
  // The open project's path: a mode switch lists its builds again.
  projectPath: string | null
  onOpenFolder: () => void
  // Opens the title bar's target picker: the mismatch fix when no build matches.
  onSwitchTarget: () => void
}

// Packages → Overview (Stage 2.2) and Install on target behind the architecture guard (2.3).
// Builds are listed when the screen opens or the project changes; nothing watches build/ yet.
export function PackagesScreen({ projectPath, onOpenFolder, onSwitchTarget }: PackagesScreenProps) {
  const { notify, echo } = useFeedback()
  const { state: devices } = useDevicesContext()
  const target = targetDevice(devices)
  const [builds, setBuilds] = useState<Builds>({ status: 'loading' })
  // Files dropped or picked here, listed with the builds for the rest of the session.
  const [inspected, setInspected] = useState<PackageBuild[]>([])
  const [reads, setReads] = useState<Record<string, Read>>({})
  const [selected, setSelected] = useState<string | null>(null)
  // Paths already asked for; a path without a result yet shows as loading.
  const requested = useRef(new Set<string>())

  useEffect(() => {
    let live = true
    void window.ovd.packages.builds().then((result) => {
      if (!live) return
      setBuilds(
        result.ok
          ? { status: 'ready', builds: result.data }
          : { status: 'error', error: result.error }
      )
    })
    return () => {
      live = false
    }
  }, [projectPath])

  const read = useCallback(async (path: string): Promise<IpcResult<PackageInfo>> => {
    requested.current.add(path)
    const result = await window.ovd.packages.info(path)
    setReads((all) => ({
      ...all,
      [path]: result.ok
        ? { status: 'ready', info: result.data }
        : { status: 'error', error: result.error }
    }))
    return result
  }, [])

  const listed = [...inspected, ...(builds.status === 'ready' ? builds.builds : [])].filter(
    (build, index, all) => all.findIndex((b) => b.path === build.path) === index
  )
  const current = listed.find((b) => b.path === selected) ?? listed[0]
  const currentRead = current ? reads[current.path] : undefined

  const readyInfo = currentRead?.status === 'ready' ? currentRead.info : undefined
  const blocker = installBlocker(target)
  // The guard runs again whenever the package, the target or its architecture changes.
  const guardKey =
    readyInfo && target?.info && blocker === null
      ? [readyInfo.path, target.id, target.info.architecture].join('\n')
      : null
  const [guard, setGuard] = useState<{ key: string; check: ArchCheck } | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)

  useEffect(() => {
    if (guardKey === null) return
    const [path = '', device = ''] = guardKey.split('\n')
    let live = true
    void window.ovd.install.check(path, device).then((result) => {
      // A failed check isn't shown: the install itself runs the guard and reports.
      if (live && result.ok) setGuard({ key: guardKey, check: result.data })
    })
    return () => {
      live = false
    }
  }, [guardKey])
  const check = guard?.key === guardKey ? guard.check : undefined

  // The first build is shown without a click, so it is read as soon as it is listed.
  useEffect(() => {
    if (current && !requested.current.has(current.path)) void read(current.path)
  }, [current, read])

  const inspect = async (path: string): Promise<void> => {
    setSelected(path)
    const result = await read(path)
    if (!result.ok) {
      notify({ tone: 'error', text: result.error.message, cli: infoCli(path) })
      return
    }
    const build = inspectedBuild(result.data)
    setInspected((all) => [build, ...all.filter((b) => b.path !== build.path)])
    notify({
      tone: 'ok',
      text: `Inspected ${result.data.file}`,
      cli: infoCli(result.data.displayPath)
    })
  }

  const pick = async (): Promise<void> => {
    const result = await window.ovd.packages.pick()
    if (!result.ok) notify({ tone: 'error', text: result.error.message })
    else if (result.data !== null) void inspect(result.data)
  }

  const select = (build: PackageBuild): void => {
    setSelected(build.path)
    echo(infoCli(build.displayPath))
  }

  const install = async (info: PackageInfo): Promise<void> => {
    if (!target) return
    const cli = installCli(info.displayPath, target.id)
    if (check && !check.allowed) {
      notify({ tone: 'error', text: 'Install blocked: architecture mismatch', cli })
      return
    }
    setInstalling(info.path)
    notify({ tone: 'info', text: `Installing ${info.file}…`, cli })
    const result = await window.ovd.install.install(info.path, target.id)
    setInstalling(null)
    notify(
      result.ok
        ? { tone: 'ok', text: `Installed on ${result.data.target.name}`, cli }
        : { tone: 'error', text: result.error.message, cli }
    )
  }

  const fix = (guarded: ArchCheck): void => {
    if (guarded.fix) select(guarded.fix)
    else onSwitchTarget()
  }

  const now = new Date()
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
      <div className="flex min-h-0 flex-col gap-3.5 overflow-auto border-r border-line px-3.5 py-5">
        <div className="flex flex-col gap-1 px-1.5">
          <h1 className="m-0 text-heading font-semibold tracking-[-0.015em]">Packages</h1>
          <div className="text-muted">Inspect .vpkg files with vpt</div>
        </div>
        <DropZone
          onFile={(file) => void inspect(window.ovd.project.pathForFile(file))}
          onPick={() => void pick()}
        />
        <div className="px-1.5 text-label tracking-[.06em] text-faint uppercase">Recent builds</div>
        {builds.status === 'loading' && inspected.length === 0 && (
          <LoadingState label="Looking in build/…" />
        )}
        {builds.status === 'error' && (
          <ErrorState title={builds.error.message} hint={builds.error.hint} />
        )}
        <ul aria-label="Recent builds" className="m-0 flex flex-col gap-2 p-0">
          {listed.map((build) => {
            const r = reads[build.path]
            return (
              <BuildRow
                key={build.path}
                build={build}
                {...(r?.status === 'ready' ? { info: r.info } : {})}
                selected={build.path === current?.path}
                onSelect={() => select(build)}
                now={now}
              />
            )
          })}
        </ul>
      </div>
      {!current ? (
        builds.status === 'loading' ? (
          <LoadingState label="Looking in build/…" />
        ) : (
          <EmptyState
            title="No packages yet"
            body={
              projectPath === null
                ? 'Drop a .vpkg to inspect it, or open a project folder to list its builds.'
                : 'This project has no .vpkg in build/ yet. Build one, or drop a .vpkg to inspect it.'
            }
            actions={
              <>
                <Button variant="primary" icon="upload_file" onClick={() => void pick()}>
                  Open a .vpkg…
                </Button>
                {projectPath === null && (
                  <Button icon="folder_open" onClick={onOpenFolder}>
                    Open a project folder…
                  </Button>
                )}
              </>
            }
          />
        )
      ) : currentRead === undefined ? (
        <LoadingState label={`Reading ${current.file}…`} />
      ) : currentRead.status === 'error' ? (
        <ErrorState title={currentRead.error.message} hint={currentRead.error.hint} />
      ) : (
        <PackageDetail
          info={currentRead.info}
          install={{
            onInstall: () => void install(currentRead.info),
            installing: installing === currentRead.info.path,
            disabledReason: blocker,
            ...(check ? { check } : {}),
            onFix: fix
          }}
        />
      )}
    </div>
  )
}
