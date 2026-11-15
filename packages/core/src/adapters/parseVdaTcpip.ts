import { unexpectedOutput } from './unexpectedOutput.js'

const RESTARTING = /^restarting in TCP mode port: (\d+)$/

// `vda tcpip <port>` confirms the port the stick now listens on. On a stick it sometimes printed
// nothing (exit 0) and had switched all the same (fixtures/0.24/vda-tcpip/empty.txt): the port is
// then unknown (null), and the connect that follows tells.
export function parseVdaTcpip(stdout: string): { port: number | null } {
  if (stdout.trim() === '') return { port: null }
  const port = RESTARTING.exec(stdout.trim())?.[1]
  if (!port) throw unexpectedOutput('vda tcpip', stdout)
  return { port: Number(port) }
}
