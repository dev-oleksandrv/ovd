import { unexpectedOutput } from './unexpectedOutput.js'

// One package as `vpm info <id> --package` prints it (fixtures/0.24/vpm-info-package).
export interface VpmPackage {
  id: string
  title: string
  version: string
  buildNumber: number
  // ISO 8601; `vpm` prints `Thu Nov  5 23:01:46 2026 GMT`.
  installedAt: string
  updatedAt: string
  // `com.amazon.package-manager.cli` side-loaded, `com.amazon.venezia|<content id>` Appstore,
  // `…package-manager.service` system.
  installerId: string
  // Empty for library packages.
  componentIds: string[]
}

// One component as `vpm info <component-id>` prints it (fixtures/0.24/vpm-info-component).
export interface VpmComponent {
  id: string
  // `interactive`, `service`, `task`…, as printed.
  type: string
  launchType?: string
}

// `vpm: '<id>': no info available (Indicated resource not found )`, exit 248.
const NOT_FOUND = /^vpm: '([^']+)': no info available/m
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const GMT = /^\w{3} (\w{3}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4}) GMT$/

export function vpmNotFound(stdout: string): string | undefined {
  return NOT_FOUND.exec(stdout)?.[1]
}

// Reads one block or several back to back (`… | xargs -n1 vpm info --package`). Each block
// starts with an unindented `id:` line; nested values are tab-indented.
export function parseVpmPackages(stdout: string): VpmPackage[] {
  const blocks = splitBlocks(stdout)
  return blocks.map((lines) => toPackage(lines, stdout))
}

export function parseVpmComponent(stdout: string): VpmComponent {
  const [lines] = splitBlocks(stdout)
  const fields = lines ? topLevel(lines) : new Map<string, string>()
  const id = fields.get('id')
  const type = fields.get('type')
  if (!id || !type) throw unexpectedOutput('vpm info', stdout)
  const launchType = fields.get('launch type')
  return { id, type, ...(launchType ? { launchType } : {}) }
}

function splitBlocks(stdout: string): string[][] {
  const blocks: string[][] = []
  for (const line of stdout.replace(/\r\n/g, '\n').split('\n')) {
    if (/^id:/.test(line)) blocks.push([])
    blocks.at(-1)?.push(line)
  }
  return blocks
}

// Unindented `key: value` lines. Keys contain spaces (`build number`), values may be empty.
function topLevel(lines: string[]): Map<string, string> {
  const fields = new Map<string, string>()
  for (const line of lines) {
    const match = /^([a-z][a-z0-9 ]*):(.*)$/.exec(line)
    if (match?.[1] && !fields.has(match[1])) fields.set(match[1], (match[2] ?? '').trim())
  }
  return fields
}

// The tab-indented lines right under `<key>:`.
function nested(lines: string[], key: string): string[] {
  const start = lines.findIndex((line) => line === `${key}:` || line.startsWith(`${key}: `))
  if (start === -1) return []
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('\t')) break
    out.push(line.trim())
  }
  return out
}

function toPackage(lines: string[], stdout: string): VpmPackage {
  const fields = topLevel(lines)
  const id = fields.get('id')
  const version = fields.get('version')
  const build = Number(fields.get('build number'))
  const installedAt = gmt(fields.get('install time'))
  const updatedAt = gmt(fields.get('update time'))
  const installerId = fields.get('installer id')
  // `version` can be empty: a system library on a stick has `version:` with nothing after it.
  if (
    !id ||
    version === undefined ||
    !Number.isInteger(build) ||
    !installedAt ||
    !updatedAt ||
    !installerId
  ) {
    throw unexpectedOutput('vpm info', stdout)
  }
  const title = nested(lines, 'title')
    .find((line) => line.startsWith('value:'))
    ?.slice('value:'.length)
    .trim()
  return {
    id,
    title: title || id,
    version,
    buildNumber: build,
    installedAt,
    updatedAt,
    installerId,
    componentIds: nested(lines, 'component ids')
  }
}

function gmt(value: string | undefined): string | undefined {
  const m = value ? GMT.exec(value) : null
  if (!m) return undefined
  const [, mon = '', day = '', hh = '', mm = '', ss = '', year = ''] = m
  const month = MONTHS.indexOf(mon)
  if (month === -1) return undefined
  return new Date(
    Date.UTC(Number(year), month, Number(day), Number(hh), Number(mm), Number(ss))
  ).toISOString()
}
