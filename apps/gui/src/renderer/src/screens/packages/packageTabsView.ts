import type {
  ErrorJson,
  FileNode,
  PackageValidation,
  ValidationIssue,
  ValidationSeverity
} from '@ovd/core'
import type { TabItem } from '../../ui/Tabs'
import type { Tone } from '../../ui/tone'

export type PackageTab = 'overview' | 'manifest' | 'files' | 'validate'

// One tab's read of one package: nothing yet, in flight, done or failed.
export type Load<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: ErrorJson }

const ORDER: Record<ValidationSeverity, number> = { error: 0, warning: 1, info: 2 }
const TONE: Record<ValidationSeverity, Tone> = { error: 'error', warning: 'warning', info: 'info' }

export function severityTone(severity: ValidationSeverity): Tone {
  return TONE[severity]
}

// The tabs, with Validate's error badge once the package was validated (none before).
export function tabItems(validation: Load<PackageValidation> | undefined): TabItem<PackageTab>[] {
  const errors = validation?.status === 'ready' ? validation.data.errors : 0
  return [
    { id: 'overview', label: 'Overview' },
    { id: 'manifest', label: 'Manifest' },
    { id: 'files', label: 'Files' },
    {
      id: 'validate',
      label: 'Validate',
      ...(errors > 0 ? { badge: errors, badgeTone: 'error' as const } : {})
    }
  ]
}

export function tabCli(tab: PackageTab, displayPath: string): string {
  return tab === 'overview' ? `ovd pkg info ${displayPath}` : `ovd pkg ${tab} ${displayPath}`
}

// `manifest.toml:7:16`, or `—` when vpt gave no location.
export function locationText(issue: ValidationIssue): string {
  if (issue.file === undefined) return '—'
  if (issue.line === undefined) return issue.file
  return `${issue.file}:${issue.line}${issue.column === undefined ? '' : `:${issue.column}`}`
}

// A row opens Manifest only when it points at a line of the manifest.
export function issueLine(issue: ValidationIssue): number | undefined {
  return issue.file === 'manifest.toml' ? issue.line : undefined
}

export function issueText(issue: ValidationIssue): string {
  return issue.key ? `[${issue.key}] ${issue.message}` : issue.message
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

// "No problems found", "Valid · 5 notes" or "3 errors · 5 notes".
export function summaryText(v: PackageValidation): string {
  const notes = v.warnings + v.infos
  if (v.valid) return notes === 0 ? 'No problems found' : `Valid · ${count(notes, 'note', 'notes')}`
  const parts = [count(v.errors, 'error', 'errors')]
  if (notes > 0) parts.push(count(notes, 'note', 'notes'))
  return parts.join(' · ')
}

// The manifest's notes: those with a line, by line, and those without, for the block on top.
export function manifestNotes(v: PackageValidation | undefined): {
  byLine: Map<number, ValidationIssue[]>
  unlocated: ValidationIssue[]
} {
  const byLine = new Map<number, ValidationIssue[]>()
  const unlocated: ValidationIssue[] = []
  for (const issue of v?.issues ?? []) {
    const line = issueLine(issue)
    if (line === undefined) unlocated.push(issue)
    else byLine.set(line, [...(byLine.get(line) ?? []), issue])
  }
  return { byLine, unlocated }
}

export function worstSeverity(issues: ValidationIssue[]): ValidationSeverity | undefined {
  return [...issues].sort((a, b) => ORDER[a.severity] - ORDER[b.severity])[0]?.severity
}

// Errors the Files tab shows on `manifest.toml`: located there, or naming a manifest key with
// no location (an OS version missing from the registry).
export function manifestErrors(v: PackageValidation | undefined): number {
  return (v?.issues ?? []).filter(
    (i) =>
      i.severity === 'error' &&
      (i.file === 'manifest.toml' || (i.file === undefined && i.key !== undefined))
  ).length
}

export interface TreeRow {
  node: FileNode
  depth: number
}

// The tree, flattened in display order, all folders open.
export function treeRows(tree: FileNode[], depth = 0): TreeRow[] {
  return tree.flatMap((node) => [
    { node, depth },
    ...(node.children ? treeRows(node.children, depth + 1) : [])
  ])
}
