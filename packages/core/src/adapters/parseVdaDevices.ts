import { OvdError } from '../errors/ovdError.js'

// One line of `vega exec vda devices -l`: `<id> <state> [key:value…]` (fixtures/0.24/vda-devices).
export interface VdaEntry {
  vdaSerial: string
  state: string
  props: Record<string, string>
}

const HEADER = 'List of devices attached'

export function parseVdaDevices(stdout: string): VdaEntry[] {
  const lines = stdout.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((line) => line.trim() === HEADER)
  if (start === -1) {
    throw new OvdError(
      'UNEXPECTED_OUTPUT',
      'Could not read the device list from vega exec vda devices -l',
      'Check the Vega SDK install: vega exec vda version',
      { stdout: stdout.slice(0, 200) }
    )
  }
  return lines
    .slice(start + 1)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map(parseLine)
}

function parseLine(line: string): VdaEntry {
  const [vdaSerial = '', state = '', ...rest] = line.split(/\s+/)
  const props: Record<string, string> = {}
  for (const token of rest) {
    const colon = token.indexOf(':')
    if (colon > 0) props[token.slice(0, colon)] = token.slice(colon + 1)
  }
  return { vdaSerial, state, props }
}
