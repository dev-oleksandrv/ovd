import { unexpectedOutput } from './unexpectedOutput.js'

const LINE = /^sha384:\s*([0-9a-f]{96})\s*$/m

// `vpt checksum` prints `sha384: <hex>` (SHA-384, not SHA-256).
export function parseVptChecksum(stdout: string): { sha384: string } {
  const match = LINE.exec(stdout)
  if (!match?.[1]) throw unexpectedOutput('vpt checksum', stdout)
  return { sha384: match[1] }
}
