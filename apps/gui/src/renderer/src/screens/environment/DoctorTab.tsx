import type { Check } from '@ovd/core'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { DoctorRow } from './DoctorRow'
import { summary } from './doctorView'

interface DoctorTabProps {
  checks: Check[]
  running: boolean
  onRun: () => void
  // Shown once first run completes: "Setup complete" with a way to Devices.
  onSetupDone?: () => void
  enableVvdDevmode?: { busy: boolean; onEnable: () => void }
}

export function DoctorTab({
  checks,
  running,
  onRun,
  onSetupDone,
  enableVvdDevmode
}: DoctorTabProps) {
  return (
    <div className="flex max-w-[860px] flex-1 flex-col gap-3.5 overflow-auto px-5.5 pt-5 pb-8">
      {onSetupDone && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-accent/30 bg-accent/6 px-3.5 py-3">
          <Icon name="check_circle" size={19} fill className="text-accent" />
          <div className="flex-1">Setup complete — OVD is ready.</div>
          <Button variant="primary" size="sm" onClick={onSetupDone}>
            Go to Devices
          </Button>
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="text-hero font-semibold tracking-[-0.02em]">
          {running ? 'Running checks…' : summary(checks)}
        </div>
        <div className="flex-1" />
        <Button icon="refresh" loading={running} onClick={onRun}>
          Run ovd doctor
        </Button>
      </div>
      <ul
        aria-label="Checks"
        className="m-0 flex shrink-0 list-none flex-col overflow-hidden rounded-card border border-line-soft p-0"
      >
        {checks.map((check) => (
          <DoctorRow
            key={check.id}
            check={check}
            checking={running}
            {...(enableVvdDevmode ? { enableVvdDevmode } : {})}
          />
        ))}
      </ul>
    </div>
  )
}
