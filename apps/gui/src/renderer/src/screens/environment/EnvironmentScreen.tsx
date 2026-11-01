import type { Check, CheckId, ProjectMode } from '@ovd/core'
import { useState } from 'react'
import type { DoctorHook } from '../../doctor/useDoctor'
import { useDevicesContext } from '../../devices/devicesContext'
import { useFeedback } from '../../feedback/feedbackContext'
import { Button } from '../../ui/Button'
import { ErrorState } from '../../ui/ErrorState'
import { LoadingState } from '../../ui/LoadingState'
import { Tabs } from '../../ui/Tabs'
import { DoctorTab } from './DoctorTab'
import { firstRunPassed, vvdArchLine } from './doctorView'
import { FirstRun } from './FirstRun'
import { ProjectDoctorModal } from './ProjectDoctorModal'

interface EnvironmentScreenProps {
  doctor: DoctorHook
  // The app opened in first-run mode (the first report failed the SDK or VDA).
  firstRun: boolean
  highlight: CheckId | null
  onGoDevices: () => void
  // "Run ovd doctor": shared with the palette, which toasts the same way.
  onRunDoctor: () => void
  // Opens the new-stick wizard.
  onSetup: () => void
  // The open project, for the Project row's Details title.
  project: ProjectMode | null
  onOpenFolder: () => void
}

// Re-check runs every check, so every Re-check echoes the whole doctor (ADR 0005).
const DOCTOR_CLI = 'ovd doctor --json'

// Environment (Stage 1.2): only the Doctor tab ships in the first release (ADR 0018).
export function EnvironmentScreen({
  doctor,
  firstRun,
  highlight,
  onGoDevices,
  onRunDoctor,
  onSetup,
  project,
  onOpenFolder
}: EnvironmentScreenProps) {
  const { notify } = useFeedback()
  const { vvd } = useDevicesContext()
  const { state, running } = doctor
  const [details, setDetails] = useState(false)

  // Both fixes change what doctor reports, so it runs again after each (design `frVvd`).
  const startVvd = async (): Promise<void> => {
    if (await vvd.start()) await doctor.run()
  }
  const enableVvdDevmode = async (): Promise<void> => {
    if (await vvd.enableDeveloperMode()) await doctor.run()
  }

  const recheck = async (check: Check): Promise<void> => {
    const cli = DOCTOR_CLI
    notify({ tone: 'info', text: 'Re-checking…' })
    const result = await doctor.run()
    if (!result.ok) {
      notify({ tone: 'error', text: result.error.message, cli })
      return
    }
    const now = result.data.checks.find((c) => c.id === check.id)
    if (!now) return
    if (check.id === 'sdk') {
      if (now.status === 'ok' || now.status === 'warn') {
        notify({ tone: 'ok', text: 'Vega SDK found', cli: cli })
      } else if (now.fix === 'install-cli') {
        notify({ tone: 'warning', text: 'Vega SDK found · Vega CLI missing', cli: cli })
      } else notify({ tone: 'warning', text: now.detail, cli: cli })
    } else if (check.id === 'vda') {
      if (now.status === 'ok') notify({ tone: 'ok', text: 'VDA responded', cli: cli })
      else notify({ tone: 'warning', text: now.detail, cli: cli })
    } else {
      notify({ tone: now.status === 'ok' ? 'ok' : 'warning', text: now.detail, cli })
    }
  }

  const report = state.status === 'ready' ? state.report : null
  // Read from the latest report, so Re-run updates the open dialog.
  const projectCheck = report?.checks.find((c) => c.id === 'project')

  const copyProjectOutput = async (): Promise<void> => {
    if (!projectCheck?.project) return
    try {
      await navigator.clipboard.writeText(projectCheck.project.output)
      notify({ tone: 'ok', text: 'Copied doctor output', cli: 'ovd doctor' })
    } catch {
      notify({ tone: 'error', text: 'Couldn’t copy to the clipboard' })
    }
  }

  const rerunProjectDoctor = async (): Promise<void> => {
    const result = await doctor.run()
    if (result.ok) notify({ tone: 'info', text: 'Project doctor finished', cli: 'ovd doctor' })
    else notify({ tone: 'error', text: result.error.message, cli: 'ovd doctor' })
  }
  const host = report?.host
  const inFirstRun = firstRun && report !== null && !firstRunPassed(report.checks)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-end justify-between border-b border-line px-5.5 pt-4">
        <div className="flex flex-wrap items-end gap-0.5">
          <h1 className="m-0 mr-4 pb-2.5 text-title font-semibold">Environment</h1>
          <Tabs items={[{ id: 'doctor', label: 'Doctor' }]} value="doctor" onChange={() => {}} />
        </div>
        {host && (
          <div className="pb-2.5 font-mono text-meta text-faint">
            {host.os} {host.osVersion} · {host.arch}
            {host.node !== undefined && ` · Node ${host.node}`}
          </div>
        )}
      </div>
      {state.status === 'loading' && <LoadingState label="Running checks…" />}
      {state.status === 'error' && (
        <ErrorState
          title={state.error.message}
          hint={state.error.hint}
          command="ovd doctor --json"
          actions={
            <Button icon="refresh" onClick={onRunDoctor}>
              Run ovd doctor
            </Button>
          }
        />
      )}
      {report &&
        (inFirstRun ? (
          <FirstRun
            checks={report.checks}
            highlight={highlight}
            onRecheck={(c) => void recheck(c)}
            startVvd={{
              detail: vvdArchLine(report.host),
              busy: vvd.busy === 'start',
              onStart: () => void startVvd()
            }}
            onSetup={onSetup}
          />
        ) : (
          <DoctorTab
            checks={report.checks}
            running={running}
            onRun={onRunDoctor}
            {...(firstRun ? { onSetupDone: onGoDevices } : {})}
            enableVvdDevmode={{ busy: vvd.enabling, onEnable: () => void enableVvdDevmode() }}
            onSetup={onSetup}
            onOpenFolder={onOpenFolder}
            onProjectDetails={() => setDetails(true)}
          />
        ))}
      {details && projectCheck?.project && project?.kind === 'folder' && (
        <ProjectDoctorModal
          name={project.name}
          displayPath={project.displayPath}
          report={projectCheck.project}
          running={running}
          onCopy={() => void copyProjectOutput()}
          onRerun={() => void rerunProjectDoctor()}
          onClose={() => setDetails(false)}
        />
      )}
    </div>
  )
}
