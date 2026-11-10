import type { Device, ProjectMode, RunOutcome } from '@ovd/core'
import type { IpcResult, WatchChange } from '../../../preload/api'
import type { ToastInput } from '../feedback/feedbackContext'
import { CRASHED, NOT_RUNNING } from './runView'

// The title bar's Watch toggle (Stage 3.5), pressed and not.
export const WATCHING_LABEL = 'Watching build/'
export const WATCH_OFF_LABEL = 'Watch off'

export function watchLabel(watching: boolean): string {
  return watching ? WATCHING_LABEL : WATCH_OFF_LABEL
}

// Only a project folder has a `build/` folder to watch; a .vpkg doesn't.
export function watchVisible(mode: ProjectMode | null): boolean {
  return mode?.kind === 'folder' && mode.missing !== true
}

// Why Watch can't be turned on, or null. While watching it can always be turned off, even with
// the target gone: a build that settles then says why it wasn't deployed.
export function watchDisabledReason(target: Device | undefined, watching: boolean): string | null {
  if (watching) return null
  if (target === undefined) return 'Pick a target first'
  if (target.status !== 'online') return `${target.name} is offline`
  return null
}

// The CLI equivalent (ADR 0005): the CLI's `--watch` watches the open project the same way,
// on the target the desktop shows.
export function watchCli(device: string): string {
  return `ovd run --watch --device ${device}`
}

export function watchOnToast(device: string): ToastInput {
  return { tone: 'info', text: 'Watching build/ for new builds', cli: watchCli(device) }
}

export const WATCH_OFF_TOAST: ToastInput = { tone: 'info', text: 'Watch off' }
export const WATCH_STOPPED_TOAST: ToastInput = {
  tone: 'info',
  text: 'Watch off · another project was opened'
}

// The toast of a batch that deploys nothing (no build for the target, or the target couldn't be
// read); null when it has a build, whose run shows its steps instead.
export function changedToast(change: WatchChange, device: string): ToastInput | null {
  const cli = watchCli(change.target?.id ?? device)
  if (change.error) {
    return { tone: 'error', text: `${change.error.message}. ${change.error.hint}`, cli }
  }
  if (change.build) return null
  return {
    tone: 'info',
    text: `Build folder changed · no build for ${change.target?.name ?? 'the target'}`,
    cli
  }
}

// The toast a finished redeploy shows.
export function redeployedToast(result: IpcResult<RunOutcome>, device: string): ToastInput {
  const cli = watchCli(device)
  if (!result.ok) {
    return { tone: 'error', text: `${result.error.message}. ${result.error.hint}`, cli }
  }
  const { launch, package: pkg, target } = result.data
  if (launch.verified) {
    return { tone: 'ok', text: `Redeployed ${pkg.file} on ${target.name} · verified`, cli }
  }
  return {
    tone: 'error',
    text: launch.reason === 'crashed' ? `${pkg.title}: ${CRASHED}` : `${pkg.title}: ${NOT_RUNNING}`,
    cli
  }
}
