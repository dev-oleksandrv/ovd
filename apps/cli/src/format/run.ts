import type { RunOutcome, RunStep } from '@ovd/core'
import { installedLine } from './install.js'

// Each step as it starts, on stderr; `follow` is printed once the run is (`commands/run.ts`).
export function runStepLine(step: RunStep): string | undefined {
  switch (step.step) {
    case 'build': {
      const { package: pkg } = step
      const where = pkg.folder === undefined ? pkg.displayPath : `${pkg.folder}${pkg.file}`
      const type = pkg.buildType === 'unknown' ? '' : ` (${pkg.buildType})`
      return `Found build ${where}${type}\n`
    }
    case 'install':
      return `Installing on ${step.target.name}…\n`
    case 'logs':
      return 'Starting the log session…\n'
    case 'launch':
      return 'Launching…\n'
    case 'verify':
      return 'Verifying launch…\n'
    case 'follow':
      return undefined
  }
}

// "Installed player_aarch64.vpkg (com.example.player 1.4.2) on … · aarch64", then the launch.
export function runLines(result: RunOutcome): string {
  const { launch } = result
  const pid = launch.verified ? ` · verified, pid ${launch.pid}` : ''
  return `${installedLine(result)}Launched ${launch.app.componentId} on ${launch.target.name}${pid}\n`
}
