import type { Check, CheckId, CheckStatus } from '@ovd/core'
import type { Tone } from '../../ui/tone'

// Icons and tones per status, from the design's Doctor rows.
const ROWS: Record<CheckStatus, { icon: string; tone: Tone }> = {
  ok: { icon: 'check_circle', tone: 'ok' },
  info: { icon: 'info', tone: 'info' },
  warn: { icon: 'error', tone: 'warning' },
  fail: { icon: 'cancel', tone: 'error' },
  skipped: { icon: 'radio_button_unchecked', tone: 'muted' }
}

export function rowView(status: CheckStatus): { icon: string; tone: Tone } {
  return ROWS[status]
}

export function summary(checks: Check[]): string {
  const failing = checks.filter((c) => c.status === 'fail').length
  const warnings = checks.filter((c) => c.status === 'warn').length
  if (failing + warnings === 0) return 'All checks passed'
  return `${failing} failing · ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`
}

// First run has three checks (spec D7).
export const FIRST_RUN: readonly CheckId[] = ['sdk', 'vda', 'devices']

// SDK and VDA pass unless they failed or waited; Devices passes only with a device online.
export function passed(check: Check | undefined): boolean {
  if (!check) return false
  if (check.id === 'devices') return check.status === 'ok'
  return check.status === 'ok' || check.status === 'warn' || check.status === 'info'
}

const byId = (checks: Check[], id: CheckId) => checks.find((c) => c.id === id)

export function firstRunCount(checks: Check[]): string {
  return `${FIRST_RUN.filter((id) => passed(byId(checks, id))).length} of 3 ready`
}

export function firstRunPassed(checks: Check[]): boolean {
  return FIRST_RUN.every((id) => passed(byId(checks, id)))
}

// Navigation bounces back to Doctor only while the SDK or VDA fail (spec D8).
export function gateOpen(checks: Check[]): boolean {
  return passed(byId(checks, 'sdk')) && passed(byId(checks, 'vda'))
}

// The check to highlight when the gate bounces the user back.
export function gateFailure(checks: Check[]): CheckId | null {
  return (['sdk', 'vda'] as const).find((id) => !passed(byId(checks, id))) ?? null
}
