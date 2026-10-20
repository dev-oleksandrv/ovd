import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../../fixtures/', import.meta.url))

// Reads a recorded SDK output, e.g. fixture('0.24/vega-version/manager.txt').
export function fixture(path: string): string {
  return readFileSync(root + path, 'utf8')
}
