import { z } from 'zod'
import { unexpectedOutput } from './unexpectedOutput.js'

// The emulator console answers in CRLF lines and in several chunks; a reply is complete only
// at a line that is exactly `OK` or starts with `KO` (fixtures/0.24/emulator-console).
export interface ConsoleReply {
  ok: boolean
  // The reply's lines before its `OK` or `KO` line.
  lines: string[]
  // The text after `KO: ` when the console refused the command.
  error?: string
}

// The lines that have ended so far; the last piece may still be arriving.
function completeLines(text: string): string[] {
  return text
    .split('\n')
    .slice(0, -1)
    .map((l) => l.replace(/\r$/, ''))
}

function terminator(line: string): boolean {
  return line === 'OK' || line.startsWith('KO')
}

export function consoleReplyDone(text: string): boolean {
  return completeLines(text).some(terminator)
}

export function parseConsoleReply(text: string): ConsoleReply {
  const lines = completeLines(text)
  const end = lines.findIndex(terminator)
  const last = lines[end]
  if (last === undefined) throw unexpectedOutput('the emulator console', text)
  const before = lines.slice(0, end)
  if (last === 'OK') return { ok: true, lines: before }
  return { ok: false, lines: before, error: last.replace(/^KO:?\s*/, '') }
}

// What only the emulator console sends on connect, so OVD never sends the token to another
// program listening on the port.
export function isConsoleGreeting(text: string): boolean {
  return text.startsWith('Android Console:')
}

const grpcLine = z.object({ port: z.string().regex(/^\d+$/) })

// `grpc <port>` answers `OK: { "port": "8554" }`, a line about the endpoint, then `OK`.
export function parseGrpcEnabled(text: string): { port: number } {
  const reply = parseConsoleReply(text)
  if (reply.ok) {
    for (const line of reply.lines) {
      const json = /^OK:\s*(\{.*\})\s*$/.exec(line)?.[1]
      if (json === undefined) continue
      let value: unknown
      try {
        value = JSON.parse(json)
      } catch {
        continue
      }
      const parsed = grpcLine.safeParse(value)
      if (parsed.success) return { port: Number(parsed.data.port) }
    }
  }
  throw unexpectedOutput('the emulator console grpc reply', text)
}
