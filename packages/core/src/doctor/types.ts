export type CheckId = 'sdk' | 'vda' | 'devices' | 'devmode' | 'metro' | 'node'
export type CheckStatus = 'ok' | 'info' | 'warn' | 'fail' | 'skipped'
// What a surface can offer to fix a check; each surface shows only the fixes it has shipped.
export type CheckFix = 'install-sdk' | 'install-cli' | 'start-vvd' | 'setup-stick'

export interface Check {
  id: CheckId
  name: string
  status: CheckStatus
  detail: string
  // The command the check ran, as users would type it. Absent when no command runs.
  command?: string
  hint?: string
  fix?: CheckFix
}

export interface HostInfo {
  os: string
  osVersion: string
  arch: string
  // The Node the user's shell finds (the doctor's Node check); absent when it finds none.
  node?: string
}

export interface DoctorReport {
  host: HostInfo
  checks: Check[]
}
