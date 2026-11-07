import type {
  LaunchResult,
  ReinstallResult,
  RestartResult,
  TerminateResult,
  UninstallResult
} from '@ovd/core'
import { installedLine } from './install.js'

export function launchedLine(result: LaunchResult): string {
  return `Launched ${result.app.componentId} on ${result.target.name}\n`
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
  return result.wasRunning
    ? `Restarted ${app.componentId} on ${target.name}\n`
    : `Started ${app.componentId} on ${target.name} (it wasn’t running)\n`
}

export function uninstalledLine(result: UninstallResult): string {
  return `Uninstalled ${result.app.packageId} from ${result.target.name}\n`
}

// "Reinstalled player_aarch64.vpkg (com.example.player 1.4.2) on …".
export function reinstalledLine(result: ReinstallResult): string {
  return `Re${installedLine(result).replace(/^I/, 'i')}`
}
