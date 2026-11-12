import type { RebootResult } from '@ovd/core'

// "Rebooted Vega Virtual Device · back online in 12 s".
export function rebootedLine(result: RebootResult): string {
  return `Rebooted ${result.target.name} · back online in ${result.seconds} s\n`
}
