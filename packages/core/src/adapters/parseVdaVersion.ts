import { unexpectedOutput } from './unexpectedOutput.js'

const FIRST_LINE = /^Vega Device Adapter version (\S+)/

// `vega exec vda version`: three text lines; only the adapter version is used.
export function parseVdaVersion(stdout: string): { version: string } {
  const version = FIRST_LINE.exec(stdout.trim())?.[1]
  if (!version) throw unexpectedOutput('vega exec vda version', stdout)
  return { version }
}
