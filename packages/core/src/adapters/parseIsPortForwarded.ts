import { unexpectedOutput } from './unexpectedOutput.js'

// `vega device is-port-forwarded` prints a bare `true` or `false`.
export function parseIsPortForwarded(stdout: string): boolean {
  const text = stdout.trim()
  if (text === 'true') return true
  if (text === 'false') return false
  throw unexpectedOutput('vega device is-port-forwarded', stdout)
}
