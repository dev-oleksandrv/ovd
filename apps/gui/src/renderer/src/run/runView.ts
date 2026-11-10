import type {
  Device,
  ErrorJson,
  LaunchCrash,
  ProjectMode,
  RunOutcome,
  RunStepName
} from '@ovd/core'
import type { IpcResult, RunProgress } from '../../../preload/api'
import type { ToastInput } from '../feedback/feedbackContext'

export type RunRowStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped'

export interface RunRow {
  id: RunStepName
  label: string
  status: RunRowStatus
  // The build file, the target, or why the row failed or was skipped.
  detail?: string
}

// A run's steps as the dropdown shows them. `crash` when the launch crashed (ADR 0012).
export type RunState =
  | { phase: 'idle' }
  | {
      phase: 'running' | 'done' | 'failed'
      device: string
      rows: RunRow[]
      error?: ErrorJson
      crash?: LaunchCrash
    }

export type RunEvent =
  | { kind: 'start'; device: string }
  | { kind: 'progress'; progress: RunProgress }
  | { kind: 'finish'; result: IpcResult<RunOutcome> }

const LABELS: Record<RunStepName, string> = {
  build: 'Pick build',
  install: 'Install',
  logs: 'Start log session',
  launch: 'Launch',
  verify: 'Verify launch',
  follow: 'Following logs'
}
const ORDER: RunStepName[] = ['build', 'install', 'logs', 'launch', 'verify', 'follow']

// The same words as core's LAUNCH_NOT_VERIFIED reasons (ADR 0012).
export const CRASHED = 'Crashed on launch'
export const NOT_RUNNING = 'Not running after launch'
export const RESTART_OFF = 'Restart after install is off'

function freshRows(): RunRow[] {
  // The run starts by picking the build: that row is active until the first step arrives.
  return ORDER.map((id, i) => ({ id, label: LABELS[id], status: i === 0 ? 'active' : 'pending' }))
}

// Rows before `id` that are still active are done; `id` becomes active.
function startRow(rows: RunRow[], id: RunStepName, detail?: string): RunRow[] {
  const at = ORDER.indexOf(id)
  return rows.map((row, i) => {
    if (i < at && row.status === 'active') return { ...row, status: 'done' }
    if (row.id !== id) return row
    return { ...row, status: 'active', ...(detail === undefined ? {} : { detail }) }
  })
}

function patch(rows: RunRow[], id: RunStepName, next: Partial<RunRow>): RunRow[] {
  return rows.map((row) => (row.id === id ? { ...row, ...next } : row))
}

export function runReducer(state: RunState, event: RunEvent): RunState {
  if (event.kind === 'start') return { phase: 'running', device: event.device, rows: freshRows() }
  if (state.phase !== 'running') return state
  if (event.kind === 'progress') {
    const { progress } = event
    if (progress.kind === 'logs') {
      return progress.outcome === 'skipped'
        ? { ...state, rows: patch(state.rows, 'logs', { status: 'skipped', detail: RESTART_OFF }) }
        : state
    }
    const { step } = progress
    if (step.step === 'build' || step.step === 'install') {
      const pkg = step.package
      const detail =
        step.step === 'build'
          ? `${pkg.folder ?? ''}${pkg.file}${pkg.buildType === 'unknown' ? '' : ` · ${pkg.buildType}`}`
          : `on ${step.target.name}`
      return { ...state, rows: startRow(state.rows, step.step, detail) }
    }
    return { ...state, rows: startRow(state.rows, step.step) }
  }
  const { result } = event
  if (!result.ok) {
    const failedAt = state.rows.find((r) => r.status === 'active')?.id ?? 'build'
    return {
      ...state,
      phase: 'failed',
      error: result.error,
      rows: patch(state.rows, failedAt, { status: 'failed', detail: result.error.message })
    }
  }
  const { launch } = result.data
  const finished = state.rows.map((row) =>
    row.status === 'active' || row.status === 'pending' ? { ...row, status: 'done' as const } : row
  )
  if (launch.verified) return { ...state, phase: 'done', rows: finished }
  const upToVerify = state.rows.map((row) =>
    row.id === 'verify' || row.id === 'follow'
      ? row
      : row.status === 'active' || row.status === 'pending'
        ? { ...row, status: 'done' as const }
        : row
  )
  const detail =
    launch.reason === 'crashed'
      ? [CRASHED, launch.crash.message].filter(Boolean).join(' · ')
      : NOT_RUNNING
  return {
    ...state,
    phase: 'failed',
    ...(launch.reason === 'crashed' ? { crash: launch.crash } : {}),
    rows: patch(upToVerify, 'verify', { status: 'failed', detail })
  }
}

// What the button runs: the open project's name or the .vpkg's file.
export function runLabel(mode: ProjectMode | null): string {
  if (mode === null) return 'Run'
  return `Run ▸ ${mode.kind === 'folder' ? mode.name : mode.file}`
}

// Why Run is disabled, or null when it can run (gui rules: disabled actions say why).
export function runDisabledReason(
  mode: ProjectMode | null,
  target: Device | undefined,
  running: boolean
): string | null {
  if (mode === null) return 'Open a project or drop a .vpkg'
  if (mode.missing) {
    return mode.kind === 'folder'
      ? `${mode.displayPath} is no longer a Vega project`
      : `${mode.displayPath} doesn’t exist`
  }
  if (target === undefined) return 'Pick a target first'
  if (target.status !== 'online') return `${target.name} is offline`
  if (running) return 'A run is in progress'
  return null
}

// A run main refused or never answered (a run still in progress after a reload, an IPC
// failure): finished as failed like any other error, so Run is enabled again.
export const RUN_NOT_STARTED: ErrorJson = {
  code: 'COMMAND_FAILED',
  message: 'Couldn’t start the run',
  hint: 'A run may still be in progress: wait for it to finish, then try again.'
}

// The CLI equivalent (ADR 0005): core runs with no ref, so it reads the open project or .vpkg,
// exactly as this does.
export function runCli(device: string): string {
  return `ovd run --device ${device}`
}

// The toast a finished run shows.
export function runToast(result: IpcResult<RunOutcome>, device: string): ToastInput {
  const cli = runCli(device)
  if (!result.ok) {
    return { tone: 'error', text: `${result.error.message}. ${result.error.hint}`, cli }
  }
  const { launch, package: pkg, target } = result.data
  if (launch.verified) {
    return { tone: 'ok', text: `Running ${pkg.file} on ${target.name} · verified`, cli }
  }
  return {
    tone: 'error',
    text: launch.reason === 'crashed' ? `${pkg.title}: ${CRASHED}` : `${pkg.title}: ${NOT_RUNNING}`,
    cli
  }
}
