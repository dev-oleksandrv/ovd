import type { Check } from '@ovd/core'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { toneText } from '../../ui/tone'
import { rowView } from './doctorView'

interface DoctorRowProps {
  check: Check
  checking?: boolean
  // Turns on Virtual Device Developer Mode (fix `enable-vvd-devmode`).
  enableVvdDevmode?: { busy: boolean; onEnable: () => void }
  // Opens the new-stick wizard (fix `setup-stick`).
  onSetup?: () => void
  // Project row: opens the folder picker while no project is open.
  onOpenFolder?: () => void
  // Project row: shows every `vega project doctor` check.
  onDetails?: () => void
}

// One row of the Doctor list. Fix buttons join with the slices that ship them (ADR 0018).
export function DoctorRow({
  check,
  checking = false,
  enableVvdDevmode,
  onSetup,
  onOpenFolder,
  onDetails
}: DoctorRowProps) {
  const enable = !checking && check.fix === 'enable-vvd-devmode' ? enableVvdDevmode : undefined
  const setup = !checking && check.fix === 'setup-stick' ? onSetup : undefined
  const openFolder =
    !checking && check.id === 'project' && check.status === 'info' ? onOpenFolder : undefined
  const details = !checking && check.project ? onDetails : undefined
  const view = rowView(check.status)
  return (
    <li className="flex items-center gap-3 border-b border-line-row bg-panel px-4 py-3 last:border-b-0">
      <Icon
        name={checking ? 'pending' : view.icon}
        size={19}
        fill
        className={checking ? 'text-faint' : toneText[view.tone]}
      />
      <div className="w-[140px] flex-none font-medium">{check.name}</div>
      <div className="min-w-0 flex-1 text-compact text-muted">
        {checking ? checkingText(check) : check.detail}
      </div>
      {check.command && (
        <div className="min-w-0 flex-[0_1_190px] truncate text-right font-mono text-label text-dim">
          {check.command}
        </div>
      )}
      {enable && (
        <Button size="sm" loading={enable.busy} onClick={enable.onEnable}>
          {enable.busy ? 'Enabling…' : 'Enable'}
        </Button>
      )}
      {setup && (
        <Button size="sm" onClick={setup}>
          Set up
        </Button>
      )}
      {openFolder && (
        <Button size="sm" onClick={openFolder}>
          Open folder…
        </Button>
      )}
      {details && (
        <Button size="sm" onClick={details}>
          Details
        </Button>
      )}
    </li>
  )
}

function checkingText(check: Check): string {
  return check.id === 'project' && check.command ? 'Running vega project doctor…' : 'Checking…'
}
