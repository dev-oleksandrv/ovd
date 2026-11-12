import type { CheckId, LogExportFormat } from '@ovd/core'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { targetDevice, useDevicesContext } from '../devices/devicesContext'
import { useDoctor } from '../doctor/useDoctor'
import { useFeedback } from '../feedback/feedbackContext'
import { AppFrame } from '../frame/AppFrame'
import { CommandPalette } from '../frame/CommandPalette'
import { NavGroup } from '../frame/NavGroup'
import { NavItem } from '../frame/NavItem'
import { ProjectCard } from '../frame/ProjectCard'
import { RunButton } from '../frame/RunButton'
import { SdkStatus } from '../frame/SdkStatus'
import { SearchButton } from '../frame/SearchButton'
import { TargetPicker } from '../frame/TargetPicker'
import { TargetStatus } from '../frame/TargetStatus'
import { WatchToggle } from '../frame/WatchToggle'
import { DevicesScreen } from '../screens/devices/DevicesScreen'
import { AppsScreen } from '../screens/apps/AppsScreen'
import { LogsScreen } from '../screens/logs/LogsScreen'
import { PackagesScreen } from '../screens/packages/PackagesScreen'
import { RemoteScreen } from '../screens/remote/RemoteScreen'
import { PairWizard } from '../pairing/PairWizard'
import { useFileDrop } from '../project/useFileDrop'
import { useProject } from '../project/useProject'
import { useRun } from '../run/useRun'
import { useWatch } from '../run/useWatch'
import { useScreenshot } from '../screenshot/screenshotContext'
import { SetupWizard } from '../setup/SetupWizard'
import { firstRunNeeded, gateFailure, gateOpen } from '../screens/environment/doctorView'
import { EnvironmentScreen } from '../screens/environment/EnvironmentScreen'
import { useSdk } from '../sdk/useSdk'
import { paletteItems, type Screen } from './paletteItems'

// How long a bounced-back check stays highlighted (design `frHl`).
const HIGHLIGHT_MS = 2400

// The gallery is imported only in development, so it never ships in a release build.
const Gallery = import.meta.env.DEV
  ? lazy(() => import('../gallery/Gallery').then((m) => ({ default: m.Gallery })))
  : null

export function Shell() {
  const [info, setInfo] = useState<{ version: string } | null>(null)
  const [gallery, setGallery] = useState(false)
  const [menu, setMenu] = useState(false)
  const [palette, setPalette] = useState(false)
  const [pairing, setPairing] = useState(false)
  const [settingUp, setSettingUp] = useState(false)
  const [screen, setScreen] = useState<Screen>('devices')
  // null until the first doctor report arrives and decides the start screen.
  const [firstRun, setFirstRun] = useState<boolean | null>(null)
  const [highlight, setHighlight] = useState<CheckId | null>(null)
  // A palette export waiting for the Logs screen and its session.
  const [exportRequest, setExportRequest] = useState<{ format: LogExportFormat; n: number } | null>(
    null
  )
  const clearExportRequest = useCallback(() => setExportRequest(null), [])
  // Counts the requests, so a second one for the same format is a new request.
  const exportCount = useRef(0)
  const doctor = useDoctor()
  const { run: runDoctorNow } = doctor
  // Doctor's Project row follows the project: a mode switch runs doctor again.
  const project = useProject(
    useCallback(() => {
      void runDoctorNow()
    }, [runDoctorNow])
  )
  const { open: openProjectPath } = project
  const dragging = useFileDrop(
    useCallback(
      (file: File) => void openProjectPath(window.ovd.project.pathForFile(file)),
      [openProjectPath]
    )
  )
  const projectMode = project.state.status === 'ready' ? project.state.mode : null
  const { state, setTarget, vvd } = useDevicesContext()
  const { notify } = useFeedback()
  const screenshot = useScreenshot()
  const report = doctor.state.status === 'ready' ? doctor.state.report : null
  // Each new device error or doctor result may mean the SDK changed (installed, removed), so
  // it asks again.
  const sdk = useSdk(
    `${state.status === 'error' ? state.error.code : state.status}:${report?.checks[0]?.status ?? ''}`
  )
  const devices = state.status === 'ready' ? state.devices : []
  const target = targetDevice(state)

  useEffect(() => {
    window.ovd.appInfo().then(setInfo)
  }, [])

  // The first report picks the start screen: Doctor while the SDK or VDA fail (spec D8).
  // Set during render (not in an effect) so the wrong screen never paints.
  if (firstRun === null && report) {
    const needed = firstRunNeeded(report.checks)
    setFirstRun(needed)
    if (needed) setScreen('doctor')
  }

  useEffect(() => {
    if (!highlight) return
    const timer = setTimeout(() => setHighlight(null), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlight])

  // Whether it went to `next`: the first-run gate may send it to Doctor instead.
  const go = (next: Screen): boolean => {
    setGallery(false)
    setExportRequest(null)
    if (next !== 'doctor' && firstRun && report && !gateOpen(report.checks)) {
      setScreen('doctor')
      setHighlight(gateFailure(report.checks))
      return false
    }
    setScreen(next)
    return true
  }

  // A verified run opens Logs; a crash's toast and the steps offer it.
  const openLogs = (): void => void go('logs')
  const run = useRun({ onDone: openLogs, onOpenLogs: openLogs })
  const watch = useWatch({ mode: projectMode, run })

  const runDoctor = async (): Promise<void> => {
    const result = await doctor.run()
    if (result.ok) notify({ tone: 'info', text: 'ovd doctor finished', cli: 'ovd doctor --json' })
    else notify({ tone: 'error', text: result.error.message, cli: 'ovd doctor --json' })
  }

  const platform = window.ovd.platform
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // ⌘ on macOS only: Ctrl+K there is a text shortcut (kill to end of line) in inputs.
      const mod = platform === 'linux' ? event.ctrlKey : event.metaKey
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setMenu(false)
        setPalette((open) => !open)
      } else if (event.key === 'Escape') {
        setPalette(false)
      } else if (Gallery && mod && event.shiftKey && event.key.toLowerCase() === 'g') {
        setGallery((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [platform])

  const items = paletteItems({
    devices,
    target: target?.id ?? null,
    go,
    runDoctor: () => {
      go('doctor')
      void runDoctor()
    },
    exportLogs: (format) => {
      if (go('logs')) setExportRequest({ format, n: ++exportCount.current })
    },
    vvd: { busy: vvd.busy, start: () => void vvd.start(), stop: () => void vvd.stop() },
    screenshot: {
      busy: screenshot.busy,
      unavailable: screenshot.unavailable,
      take: () => void screenshot.take()
    },
    setup: () => setSettingUp(true),
    pair: () => setPairing(true),
    switchTarget: (device) => void setTarget(device),
    later: (label) => notify({ tone: 'info', text: `${label} is coming in a later version` })
  })

  return (
    <AppFrame
      version={info?.version ?? null}
      platform={platform}
      titleBar={
        <>
          <TargetPicker
            devices={devices}
            target={target}
            open={menu}
            onOpenChange={setMenu}
            onPick={(device) => void setTarget(device)}
            onSetup={() => setSettingUp(true)}
            onPair={() => setPairing(true)}
            vvdBusy={vvd.busy}
          />
          <RunButton
            mode={projectMode}
            target={target}
            state={run.state}
            onRun={(device) => void run.start(device)}
            onOpenLogs={openLogs}
          />
          <WatchToggle
            mode={projectMode}
            target={target}
            watching={watch.watching}
            onToggle={() => void watch.toggle(target?.id)}
          />
          <div className="flex-1" />
          <SearchButton
            platform={platform}
            onClick={() => {
              setMenu(false)
              setPalette(true)
            }}
          />
        </>
      }
      status={
        <>
          <SdkStatus sdk={sdk} onClick={() => go('doctor')} />
          <TargetStatus
            target={target}
            onClick={() => setMenu((open) => !open)}
            vvdBusy={vvd.busy}
          />
        </>
      }
      sidebarFooter={
        project.state.status === 'loading' ? null : (
          <ProjectCard
            mode={projectMode}
            dragging={dragging}
            onPickVpkg={() => void project.pickVpkg()}
            onPickFolder={() => void project.pickFolder()}
          />
        )
      }
      sidebar={
        // Only shipped screens appear (ADR 0018).
        <>
          <NavGroup label="Device">
            <NavItem
              label="Devices"
              icon="tv"
              active={!gallery && screen === 'devices'}
              onClick={() => go('devices')}
            />
            <NavItem
              label="Apps"
              icon="apps"
              active={!gallery && screen === 'apps'}
              onClick={() => go('apps')}
            />
            <NavItem
              label="Packages"
              icon="deployed_code"
              active={!gallery && screen === 'packages'}
              onClick={() => go('packages')}
            />
          </NavGroup>
          <NavGroup label="Debug">
            <NavItem
              label="Logs"
              icon="subject"
              active={!gallery && screen === 'logs'}
              onClick={() => go('logs')}
            />
            <NavItem
              label="Remote & Screen"
              icon="settings_remote"
              active={!gallery && screen === 'remote'}
              onClick={() => go('remote')}
            />
          </NavGroup>
          <NavGroup label="Setup">
            <NavItem
              label="Doctor"
              icon="health_and_safety"
              active={!gallery && screen === 'doctor'}
              onClick={() => go('doctor')}
            />
          </NavGroup>
        </>
      }
    >
      {gallery && Gallery ? (
        <Suspense fallback={null}>
          <Gallery />
        </Suspense>
      ) : screen === 'doctor' ? (
        <EnvironmentScreen
          doctor={doctor}
          firstRun={firstRun === true}
          highlight={highlight}
          onGoDevices={() => go('devices')}
          onRunDoctor={() => void runDoctor()}
          onSetup={() => setSettingUp(true)}
          project={projectMode}
          onOpenFolder={() => void project.pickFolder()}
        />
      ) : screen === 'apps' ? (
        <AppsScreen
          onSwitchTarget={() => setMenu(true)}
          onGoPackages={() => go('packages')}
          projectPath={projectMode?.path ?? null}
        />
      ) : screen === 'logs' ? (
        <LogsScreen
          onSwitchTarget={() => setMenu(true)}
          projectAppId={projectMode?.kind === 'folder' ? (projectMode.packageId ?? null) : null}
          exportRequest={exportRequest}
          onExportHandled={clearExportRequest}
        />
      ) : screen === 'remote' ? (
        <RemoteScreen onSwitchTarget={() => setMenu(true)} />
      ) : screen === 'packages' ? (
        <PackagesScreen
          projectPath={projectMode?.path ?? null}
          onOpenFolder={() => void project.pickFolder()}
          onSwitchTarget={() => setMenu(true)}
        />
      ) : (
        <DevicesScreen
          onSetup={() => setSettingUp(true)}
          onPair={() => setPairing(true)}
          onOpenApps={() => go('apps')}
        />
      )}
      {palette && <CommandPalette items={items} onClose={() => setPalette(false)} />}
      {settingUp && (
        <SetupWizard
          onClose={() => setSettingUp(false)}
          onPair={() => {
            setSettingUp(false)
            setPairing(true)
          }}
          onDone={() => {
            setSettingUp(false)
            go('devices')
          }}
        />
      )}
      {pairing && (
        <PairWizard
          onSetup={() => {
            setPairing(false)
            setSettingUp(true)
          }}
          onClose={() => setPairing(false)}
          onDone={() => {
            setPairing(false)
            go('devices')
          }}
        />
      )}
    </AppFrame>
  )
}
