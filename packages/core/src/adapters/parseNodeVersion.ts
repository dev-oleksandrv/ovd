import { unexpectedOutput } from './unexpectedOutput.js'

const VERSION_LINE = /^v(\d+\.\d+\.\d+)\s*$/gm

// `node --version` through the login shell: the shell may print its own lines first, so the
// last version line is Node's.
export function parseNodeVersion(stdout: string): { version: string } {
  const version = [...stdout.matchAll(VERSION_LINE)].at(-1)?.[1]
  if (!version) throw unexpectedOutput('node --version', stdout)
  return { version }
}
