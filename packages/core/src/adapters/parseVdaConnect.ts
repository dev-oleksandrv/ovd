import { unexpectedOutput } from './unexpectedOutput.js'

export type VdaConnect =
  | { result: 'connected'; id: string }
  | { result: 'refused' | 'timed-out' | 'bad-address'; message: string }

// `vda connect` exits 0 whatever happens, so its one line of stdout is the only signal
// (fixtures/0.24/vda-connect).
const CONNECTED = /^(?:already )?connected to (\S+)$/
const REFUSED = /^failed to connect to .*: Connection refused$/
const TIMED_OUT = /^failed to connect to .*: Operation timed out$/
const BAD_ADDRESS = /^(?:bad port number |failed to resolve host: )/

export function parseVdaConnect(stdout: string): VdaConnect {
  const line = stdout.trim()
  const id = CONNECTED.exec(line)?.[1]
  if (id) return { result: 'connected', id }
  if (REFUSED.test(line)) return { result: 'refused', message: line }
  if (TIMED_OUT.test(line)) return { result: 'timed-out', message: line }
  if (BAD_ADDRESS.test(line)) return { result: 'bad-address', message: line }
  throw unexpectedOutput('vda connect', stdout)
}
