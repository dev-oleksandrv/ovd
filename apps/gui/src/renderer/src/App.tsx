import type { CheckId } from '@ovd/core'
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { DevicesProvider } from './devices/DevicesProvider'
import { targetDevice, useDevicesContext } from './devices/devicesContext'
import { useDoctor } from './doctor/useDoctor'
import { useFeedback } from './feedback/feedbackContext'
import { AppFrame } from './frame/AppFrame'
import { CommandPalette } from './frame/CommandPalette'
import { NavGroup } from './frame/NavGroup'
import { NavItem } from './frame/NavItem'
import { ProjectCard } from './frame/ProjectCard'
import { SdkStatus } from './frame/SdkStatus'
import { SearchButton } from './frame/SearchButton'
import { TargetPicker } from './frame/TargetPicker'
import { TargetStatus } from './frame/TargetStatus'
import { DevicesScreen } from './screens/devices/DevicesScreen'
import { PackagesScreen } from './screens/packages/PackagesScreen'
import { PairWizard } from './pairing/PairWizard'
import { useFileDrop } from './project/useFileDrop'
import { useProject } from './project/useProject'
import { SetupWizard } from './setup/SetupWizard'
import { firstRunNeeded, gateFailure, gateOpen } from './screens/environment/doctorView'
import { EnvironmentScreen } from './screens/environment/EnvironmentScreen'
import { useSdk } from './sdk/useSdk'
import { paletteItems, type Screen } from './shell/paletteItems'

// How long a bounced-back check stays highlighted (design `frHl`).
const HIGHLIGHT_MS = 2400

// The gallery is imported only in development, so it never ships in a release build.
const Gallery = import.meta.env.DEV
  ? lazy(() => import('./gallery/Gallery').then((m) => ({ default: m.Gallery })))
  : null

export function App() {
  return (
    <DevicesProvider>
      <Shell />
    </DevicesProvider>
  )
}

function Shell() {
  const [info, setInfo] = useState<{ version: string; platform: 'darwin' | 'linux' } | null>(null)
  const [gallery, setGallery] = useState(false)
  const [menu, setMenu] = useState(false)
  const [palette, setPalette] = useState(false)
  const [pairing, setPairing] = useState(false)
  const [settingUp, setSettingUp] = useState(false)
  const [screen, setScreen] = useState<Screen>('devices')
  // null until the first doctor report arrives and decides the start screen.
  const [firstRun, setFirstRun] = useState<boolean | null>(null)
  const [highlight, setHighlight] = useState<CheckId | null>(null)
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

  const go = (next: Screen): void => {
    setGallery(false)
    if (next !== 'doctor' && firstRun && report && !gateOpen(report.checks)) {
      setScreen('doctor')
      setHighlight(gateFailure(report.checks))
      return
    }
    setScreen(next)
  }

  const runDoctor = async (): Promise<void> => {
    const result = await doctor.run()
    if (result.ok) notify({ tone: 'info', text: 'ovd doctor finished', cli: 'ovd doctor --json' })
    else notify({ tone: 'error', text: result.error.message, cli: 'ovd doctor --json' })
  }

  const platform = info?.platform ?? null
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
    vvd: { busy: vvd.busy, start: () => void vvd.start(), stop: () => void vvd.stop() },
    setup: () => setSettingUp(true),
    pair: () => setPairing(true),
    switchTarget: (device) => void setTarget(device),
    later: (label) => notify({ tone: 'info', text: `${label} is coming in a later version` })
  })

  return (
    <AppFrame
      version={info?.version ?? null}
      platform={info?.platform ?? null}
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
          <div className="flex-1" />
          <SearchButton
            platform={info?.platform ?? null}
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
              label="Packages"
              icon="deployed_code"
              active={!gallery && screen === 'packages'}
              onClick={() => go('packages')}
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
      ) : screen === 'packages' ? (
        <PackagesScreen
          projectPath={projectMode?.path ?? null}
          onOpenFolder={() => void project.pickFolder()}
          onSwitchTarget={() => setMenu(true)}
        />
      ) : (
        <DevicesScreen onSetup={() => setSettingUp(true)} onPair={() => setPairing(true)} />
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
