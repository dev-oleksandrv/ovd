import { unexpectedOutput } from './unexpectedOutput.js'

const STATE = /^developer-mode: (enable|disable)$/
const SET = /^(enabled|disabled)$/

// `vsm developer-mode` (no argument) prints the current state.
export function parseVsmDeveloperMode(stdout: string): { enabled: boolean } {
  const state = STATE.exec(stdout.trim())?.[1]
  if (!state) throw unexpectedOutput('vsm developer-mode', stdout)
  return { enabled: state === 'enable' }
}

// `vsm developer-mode enable|disable` prints the state it set, also when nothing changed.
export function parseVsmDeveloperModeSet(stdout: string): { enabled: boolean } {
  const state = SET.exec(stdout.trim())?.[1]
  if (!state) throw unexpectedOutput('vsm developer-mode', stdout)
  return { enabled: state === 'enabled' }
}
