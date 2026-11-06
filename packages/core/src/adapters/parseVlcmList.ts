import { unexpectedOutput } from './unexpectedOutput.js'

// One running component in `vlcm list` (fixtures/0.24/vlcm-list).
export interface VlcmEntry {
  // The component ID (`com.example.player.main`).
  application: string
  // `I` interactive, `S` service, as printed.
  type: string
  pid: number
  // `VISIBLE`, `READY`…, as printed.
  state: string
  // `PERMANENT`…, as printed: a state, not a duration (ARCHITECTURE §8).
  lifespan: string
  container: string
}

const HEADER = /^application\s+type\s+pid\s+id\s+state\s+lifespan\s+timeout\s+container\b/

// A fixed-width table with a header line; only the header when nothing matches. No JSON mode.
// Component IDs and containers have no spaces, so splitting on whitespace is safe for the
// columns OVD reads; launch args (last) may contain spaces and are ignored.
export function parseVlcmList(stdout: string): VlcmEntry[] {
  const lines = stdout.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((line) => HEADER.test(line))
  if (start === -1) throw unexpectedOutput('vlcm list', stdout)
  return lines
    .slice(start + 1)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [application = '', type = '', pid = '', , state = '', lifespan = '', , container = ''] =
        line.trim().split(/\s+/)
      const n = Number(pid)
      if (!application || !Number.isInteger(n)) throw unexpectedOutput('vlcm list', stdout)
      return { application, type, pid: n, state, lifespan, container }
    })
}
