import type { ValidationSeverity } from '@ovd/core'
import { cx } from '../../ui/cx'
import { toneTint } from '../../ui/tone'
import { severityTone } from './packageTabsView'

// vpt's severity word, tinted by its tone (error, warning, info).
export function SeverityLabel({ severity }: { severity: ValidationSeverity }) {
  return (
    <span
      className={cx(
        'inline-flex rounded-chip px-1.5 py-px font-mono text-label',
        toneTint[severityTone(severity)]
      )}
    >
      {severity}
    </span>
  )
}
