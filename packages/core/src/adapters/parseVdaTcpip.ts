import { unexpectedOutput } from './unexpectedOutput.js'

const RESTARTING = /^restarting in TCP mode port: (\d+)$/

// `vda tcpip <port>` confirms the port the stick now listens on.
export function parseVdaTcpip(stdout: string): { port: number } {
  const port = RESTARTING.exec(stdout.trim())?.[1]
  if (!port) throw unexpectedOutput('vda tcpip', stdout)
  return { port: Number(port) }
}
