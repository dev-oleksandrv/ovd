import type { Check } from '@ovd/core'
import { Icon } from '../../ui/Icon'
import { toneText } from '../../ui/tone'
import { rowView } from './doctorView'

interface DoctorRowProps {
  check: Check
  checking?: boolean
}

// One row of the Doctor list. Fix buttons join with the slices that ship them (ADR 0018).
export function DoctorRow({ check, checking = false }: DoctorRowProps) {
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
        {checking ? 'Checking…' : check.detail}
      </div>
      {check.command && (
        <div className="min-w-0 flex-[0_1_190px] truncate text-right font-mono text-label text-dim">
          {check.command}
        </div>
      )}
    </li>
  )
}
