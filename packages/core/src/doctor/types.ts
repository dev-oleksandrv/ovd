import type { ProjectDoctorResult } from '../adapters/parseProjectDoctor.js'

export type CheckId = 'sdk' | 'vda' | 'project' | 'devices' | 'devmode' | 'metro' | 'node'
export type CheckStatus = 'ok' | 'info' | 'warn' | 'fail' | 'skipped'
// What a surface can offer to fix a check; each surface shows only the fixes it has shipped.
export type CheckFix =
  'install-sdk' | 'install-cli' | 'start-vvd' | 'setup-stick' | 'enable-vvd-devmode'

export interface Check {
  id: CheckId
  name: string
  status: CheckStatus
  detail: string
  // The command the check ran, as users would type it. Absent when no command runs.
  command?: string
  hint?: string
  fix?: CheckFix
  // The Project row's full `vega project doctor` result, for its Details view.
  project?: ProjectDoctorReport
}

export interface ProjectDoctorReport extends ProjectDoctorResult {
  // What the command printed (stderr after stdout), for "Copy output".
  output: string
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
