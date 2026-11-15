import {
  escapeControls,
  type FileNode,
  type PackageFiles,
  type PackageManifest,
  type PackageValidation,
  type ValidationIssue
} from '@ovd/core'

// The manifest is a file anyone can write, and vpt quotes its values: shown with visible
// escapes, as `ovd logs` shows device text.
const text = (value: string) => escapeControls(value)

function issueText(issue: ValidationIssue): string {
  return text(issue.key ? `[${issue.key}] ${issue.message}` : issue.message)
}

export function locationText(issue: ValidationIssue): string {
  if (issue.file === undefined) return '—'
  if (issue.line === undefined) return text(issue.file)
  return `${text(issue.file)}:${issue.line}${issue.column === undefined ? '' : `:${issue.column}`}`
}

export function summaryText(v: PackageValidation): string {
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const notes = v.warnings + v.infos
  const parts = [
    count(v.errors, 'error', 'errors'),
    ...(v.warnings > 0 ? [count(v.warnings, 'warning', 'warnings')] : []),
    ...(v.infos > 0 ? [count(v.infos, 'note', 'notes')] : [])
  ]
  if (v.valid) {
    return notes === 0
      ? `${v.file}: no problems found\n`
      : `${v.file} is valid: ${parts.slice(1).join(', ')}\n`
  }
  return `${v.file} is invalid: ${parts.join(', ')}\n`
}

// `ovd pkg validate`: a summary line, then one row per issue (severity, location, message) with
// its help indented below.
export function validationText(v: PackageValidation): string {
  if (v.issues.length === 0) return summaryText(v)
  const severityWidth = Math.max(...v.issues.map((i) => i.severity.length))
  const locationWidth = Math.max(...v.issues.map((i) => locationText(i).length))
  const indent = ' '.repeat(severityWidth + locationWidth + 4)
  const rows = v.issues.map((issue) => {
    const head = `${issue.severity.padEnd(severityWidth)}  ${locationText(issue).padEnd(locationWidth)}  ${issueText(issue)}\n`
    const help = issue.help
      ? issue.help
          .split('\n')
          .map((line, index) => `${indent}${index === 0 ? 'help: ' : '      '}${text(line)}\n`)
          .join('')
      : ''
    return head + help
  })
  return `${summaryText(v)}\n${rows.join('')}`
}

// `ovd pkg manifest`: right-aligned line numbers, each located note under its line, the notes
// without a line first.
export function manifestText(m: PackageManifest): string {
  const width = String(Math.max(m.lines.length, 1)).length
  const pad = ' '.repeat(width)
  const note = (issue: ValidationIssue) => {
    const column = issue.column === undefined ? 0 : issue.column - 1
    const head = `${pad} | ${' '.repeat(column)}^ ${issue.severity}: ${issueText(issue)}\n`
    const help = issue.help
      ? issue.help
          .split('\n')
          .map((line) => `${pad} |   ${text(line)}\n`)
          .join('')
      : ''
    return head + help
  }
  const unlocated = m.validation.issues.filter((i) => i.line === undefined)
  const byLine = new Map<number, ValidationIssue[]>()
  for (const issue of m.validation.issues) {
    if (issue.line === undefined) continue
    byLine.set(issue.line, [...(byLine.get(issue.line) ?? []), issue])
  }
  const head = unlocated
    .map(
      (issue) =>
        `${issue.severity}: ${issueText(issue)}\n${issue.help ? `  ${text(issue.help).replace(/\n/g, '\n  ')}\n` : ''}`
    )
    .join('')
  const body = m.lines
    .map((line, index) => {
      const n = index + 1
      const notes = (byLine.get(n) ?? []).map(note).join('')
      return `${String(n).padStart(width)} | ${text(line)}\n${notes}`
    })
    .join('')
  // Notes past the last line (never seen) still show, after the file.
  const past = [...byLine.entries()]
    .filter(([n]) => n > m.lines.length)
    .flatMap(([, issues]) => issues)
    .map((issue) => `${locationText(issue)} ${issue.severity}: ${issueText(issue)}\n`)
    .join('')
  return `${head}${head ? '\n' : ''}${body}${past}${summaryText(m.validation)}`
}

// `ovd pkg files`: the tree, two spaces per level, folders ending in `/`.
export function filesText(f: PackageFiles): string {
  const lines: string[] = []
  const walk = (nodes: FileNode[], depth: number) => {
    for (const node of nodes) {
      lines.push(`${'  '.repeat(depth)}${text(node.name)}${node.kind === 'folder' ? '/' : ''}`)
      if (node.children) walk(node.children, depth + 1)
    }
  }
  walk(f.tree, 0)
  const n = f.entries.length
  return `${lines.join('\n')}${lines.length ? '\n' : ''}${n} ${n === 1 ? 'file' : 'files'}\n`
}
