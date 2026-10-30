import type { Check, CheckId } from '@ovd/core'
import { firstRunCount, FIRST_RUN } from './doctorView'
import { FirstRunCheck } from './FirstRunCheck'

interface FirstRunProps {
  checks: Check[]
  highlight: CheckId | null
  onRecheck: (check: Check) => void
  startVvd?: { detail: string; busy: boolean; onStart: () => void }
}

// "Set up OVD": the first three checks in order (spec D7).
export function FirstRun({ checks, highlight, onRecheck, startVvd }: FirstRunProps) {
  const cards = FIRST_RUN.flatMap((id) => checks.filter((c) => c.id === id))
  return (
    <div className="flex max-w-[860px] flex-1 flex-col gap-3.5 overflow-auto px-5.5 pt-6 pb-8">
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-hero font-semibold tracking-[-0.02em]">Set up OVD</h1>
        <div className="leading-normal text-muted">
          Doctor stays the start screen until the Vega SDK and VDA pass · {firstRunCount(checks)}
        </div>
      </div>
      {cards.map((check) => (
        <FirstRunCheck
          key={check.id}
          check={check}
          highlighted={highlight === check.id}
          onRecheck={() => onRecheck(check)}
          {...(startVvd ? { startVvd } : {})}
        />
      ))}
    </div>
  )
}
