import type { Check, CheckId, CheckStatus, HostInfo } from '@ovd/core'
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

// The app opens on first run while the SDK or VDA fail (spec D8), including a bundled-only
// vega, so its "Install the Vega CLI" fix is the first thing the user sees.
export function firstRunNeeded(checks: Check[]): boolean {
  return !(passed(byId(checks, 'sdk')) && passed(byId(checks, 'vda')))
}

// A bundled-only vega still runs device commands (spec D3): only a missing SDK locks the user
// on Doctor.
function sdkFound(check: Check | undefined): boolean {
  return passed(check) || check?.fix === 'install-cli'
}

// Navigation bounces back to Doctor only while no SDK is found or VDA fails (spec D3, D8).
export function gateOpen(checks: Check[]): boolean {
  return sdkFound(byId(checks, 'sdk')) && passed(byId(checks, 'vda'))
}

// The check to highlight when the gate bounces the user back.
export function gateFailure(checks: Check[]): CheckId | null {
  if (!sdkFound(byId(checks, 'sdk'))) return 'sdk'
  return passed(byId(checks, 'vda')) ? null : 'vda'
}

// The Virtual Device matches the host's architecture (ADR 0008); the first-run card says which.
export function vvdArchLine(host: Pick<HostInfo, 'os' | 'arch'>): string {
  const arch = host.arch === 'arm64' ? 'aarch64' : host.arch === 'x64' ? 'x86_64' : host.arch
  if (host.os !== 'macOS') return `Runs locally on this computer · ${arch}`
  return `Runs locally on this computer · ${arch} on ${arch === 'aarch64' ? 'Apple Silicon' : 'Intel'}`
}
