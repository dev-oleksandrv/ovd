import type {
  LaunchResult,
  LaunchVerification,
  OvdError,
  ReinstallResult,
  RestartResult,
  TerminateResult,
  UninstallResult
} from '@ovd/core'
import { installedLine } from './install.js'

export function launchedLine(result: LaunchResult): string {
  if (!result.launched) {
    return `${result.app.componentId} is already running on ${result.target.name} · pid ${result.pid}\n`
  }
  return `Launched ${result.app.componentId} on ${result.target.name}${verifiedSuffix(result)}\n`
}

function verifiedSuffix(result: LaunchVerification): string {
  return result.verified ? ` · verified, pid ${result.pid}` : ''
}

// An unverified launch on stderr: the error, the crash's cause and the logs around it, the hint.
export function notVerifiedText(result: LaunchVerification, error: OvdError | undefined): string {
  if (!error) return ''
  let text = `Error: ${error.message}\n`
  if (!result.verified && result.reason === 'crashed') {
    const { crash } = result
    const cause = [crash.signal, crash.message].filter(Boolean).join(' · ')
    text += `Cause: ${cause ? `${cause} ` : ''}(pid ${crash.pid}, ${crash.time})\n`
    text +=
      crash.logs.length > 0
        ? `Logs around crash:\n${crash.logs.map((l) => `  ${l}\n`).join('')}`
        : 'No log lines were captured\n'
  }
  return `${text}${error.hint}\n`
}

export function terminatedLine(result: TerminateResult): string {
  const { app, target } = result
  if (result.forced) return `Force stopped ${app.packageId} on ${target.name}\n`
  return result.wasRunning
    ? `Stopped ${app.packageId} on ${target.name}\n`
    : `${app.packageId} wasn’t running on ${target.name}\n`
}

export function restartedLine(result: RestartResult): string {
  const { app, target } = result
  const verified = verifiedSuffix(result)
  return result.wasRunning
    ? `Restarted ${app.componentId} on ${target.name}${verified}\n`
    : `Started ${app.componentId} on ${target.name} (it wasn’t running)${verified}\n`
}

export function uninstalledLine(result: UninstallResult): string {
  return `Uninstalled ${result.app.packageId} from ${result.target.name}\n`
}

// "Reinstalled player_aarch64.vpkg (com.example.player 1.4.2) on …".
export function reinstalledLine(result: ReinstallResult): string {
  return `Re${installedLine(result).replace(/^I/, 'i')}`
}
