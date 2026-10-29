import type { Check, CheckId } from '@ovd/core'
import type { DoctorHook } from '../../doctor/useDoctor'
import { useFeedback } from '../../feedback/feedbackContext'
import { Button } from '../../ui/Button'
import { ErrorState } from '../../ui/ErrorState'
import { LoadingState } from '../../ui/LoadingState'
import { Tabs } from '../../ui/Tabs'
import { DoctorTab } from './DoctorTab'
import { firstRunPassed } from './doctorView'
import { FirstRun } from './FirstRun'

interface EnvironmentScreenProps {
  doctor: DoctorHook
  // The app opened in first-run mode (the first report failed the SDK or VDA).
  firstRun: boolean
  highlight: CheckId | null
  onGoDevices: () => void
  // "Run ovd doctor": shared with the palette, which toasts the same way.
  onRunDoctor: () => void
}

const RECHECK_CLI: Partial<Record<CheckId, string>> = {
  sdk: 'vega sdk config doctor --json',
  vda: 'vega exec vda version',
  devices: 'vega exec vda devices -l'
}

// Environment (Stage 1.2): only the Doctor tab ships in the first release (ADR 0018).
export function EnvironmentScreen({
  doctor,
  firstRun,
  highlight,
  onGoDevices,
  onRunDoctor
}: EnvironmentScreenProps) {
  const { notify } = useFeedback()
  const { state, running } = doctor

  const recheck = async (check: Check): Promise<void> => {
    const cli = RECHECK_CLI[check.id]
    notify({ tone: 'info', text: 'Re-checking…' })
    const result = await doctor.run()
    if (!result.ok) {
      notify({ tone: 'error', text: result.error.message, ...(cli ? { cli } : {}) })
      return
    }
    const now = result.data.checks.find((c) => c.id === check.id)
    if (!now) return
    if (check.id === 'sdk') {
      if (now.status === 'ok' || now.status === 'warn') {
        notify({ tone: 'ok', text: 'Vega SDK found', cli: RECHECK_CLI.sdk })
      } else if (now.fix === 'install-cli') {
        notify({ tone: 'warning', text: 'Vega SDK found · Vega CLI missing', cli: RECHECK_CLI.sdk })
      } else notify({ tone: 'warning', text: now.detail, cli: RECHECK_CLI.sdk })
    } else if (check.id === 'vda') {
      if (now.status === 'ok') notify({ tone: 'ok', text: 'VDA responded', cli: RECHECK_CLI.vda })
      else notify({ tone: 'warning', text: now.detail, cli: RECHECK_CLI.vda })
    } else {
      notify({ tone: now.status === 'ok' ? 'ok' : 'warning', text: now.detail, cli: 'ovd devices' })
    }
  }

  const report = state.status === 'ready' ? state.report : null
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
            {host.os} {host.osVersion} · {host.arch} · Node {host.node}
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
          />
        ) : (
          <DoctorTab
            checks={report.checks}
            running={running}
            onRun={onRunDoctor}
            {...(firstRun ? { onSetupDone: onGoDevices } : {})}
          />
        ))}
    </div>
  )
}
