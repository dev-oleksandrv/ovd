import { OvdError } from '../errors/ovdError.js'

export function unexpectedOutput(what: string, stdout: string): OvdError {
  return new OvdError(
    'UNEXPECTED_OUTPUT',
    `Could not read ${what}`,
    'Check the Vega SDK install with ovd doctor',
    { stdout: stdout.slice(0, 200) }
  )
}

export function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch {
    return undefined
  }
}
