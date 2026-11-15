import { z } from 'zod'
import { stripControl } from './stripControl.js'
import { unexpectedOutput } from './unexpectedOutput.js'

export type ValidationSeverity = 'error' | 'warning' | 'info'

export interface ValidationIssue {
  severity: ValidationSeverity
  message: string
  // The manifest key vpt names in brackets, e.g. `package.build-number`.
  key?: string
  // Always `manifest.toml` when vpt gives a location; line and column are 1-based.
  file?: string
  line?: number
  column?: number
  help?: string
}

export type VptValidateResult =
  | { kind: 'validated'; valid: boolean; issues: ValidationIssue[] }
  // vpt didn't get to validate (a missing path, not a package): its last `Error:` line.
  | { kind: 'failed'; message: string }

const MAX_ISSUES = 1000
const MAX_TEXT = 2000

const issueSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  message: z.string().min(1).max(MAX_TEXT),
  key: z.string().min(1).max(200).optional(),
  file: z.string().min(1).max(200).optional(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  help: z.string().min(1).max(MAX_TEXT).optional()
})
const issuesSchema = z.array(issueSchema).max(MAX_ISSUES)

// `manifest.toml:7:16 error: [package.build-number] build-number must be greater than 0, …`
const DIAGNOSTIC = /^([^\s:]+):(\d+):(\d+) ([a-z]+): (.*)$/
const HELP = /^ {2}help: (.*)$/
const TOML = /^manifest parsing error: TOML parse error at line (\d+), column (\d+)$/
// The source excerpt under a TOML error: `  |`, `5 | version = "0.1.0`, `  |  ^`.
const EXCERPT = /^\s*\d*\s*\|/
const SUMMARY = /^Error: Validation failed with the following errors:$/
const ENTRY = /^Error \d+: (.*)$/
const CONTINUATION = /^ {2,}(\S.*)$/
const WARNING = /^warning: (.*)$/
// Printed for every .vpkg, good or broken: about vpt's own staging, not the package.
const STAGING = /^found 'meta-info\/' directory in the sources/
// Summary entries that only repeat the lines above them.
const GENERIC =
  /^(manifest validation failed!|manifest parsing failed!|failed to parse manifest\.toml for OS Version validation)$/
const FAILURE = /^Error: (.*)$/
const DONE = /^(done\.|manifest validation found \d+ errors?|manifest\.toml is valid)$/
// eslint-disable-next-line no-control-regex -- ANSI color sequences, in case vpt colors anyway
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g

const SEVERITIES = new Set<string>(['error', 'warning', 'info'])

// `vpt validate --no-color <pkg>` has no JSON mode (vpt 1.2.29, ARCHITECTURE §8). A valid
// package prints its diagnostics on stdout and exits 0; an invalid one prints them on stderr,
// then a summary of `Error <n>:` entries, and exits 1. Some entries have no line (an OS version
// missing from the registry); those become unlocated errors.
export function parseVptValidate(result: {
  stdout: string
  stderr: string
  exitCode: number
}): VptValidateResult {
  const lines = `${result.stdout}\n${result.stderr}`
    .split('\n')
    .map((line) => stripControl(line.replace(ANSI, '').replace(/\r$/, '')))
  const issues: ValidationIssue[] = []
  const summary: { text: string; more: string[] }[] = []
  let recognized = false
  let inSummary = false
  let failure: string | undefined

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const diagnostic = DIAGNOSTIC.exec(line)
    if (diagnostic) {
      inSummary = false
      recognized = true
      const [, file = '', row = '', col = '', word = '', rest = ''] = diagnostic
      const help = HELP.exec(lines[i + 1] ?? '')
      if (help) i++
      issues.push({
        ...keyed(rest),
        severity: severity(word),
        file,
        line: Number(row),
        column: Number(col),
        ...(help?.[1] ? { help: help[1].trim() } : {})
      })
      continue
    }
    const toml = TOML.exec(line)
    if (toml) {
      inSummary = false
      recognized = true
      const message: string[] = []
      while (i + 1 < lines.length) {
        const next = lines[i + 1] ?? ''
        if (next.trim() === '') break
        i++
        if (!EXCERPT.test(next)) message.push(next.trim())
      }
      issues.push({
        severity: 'error',
        message: message.join(' ') || 'TOML parse error',
        file: 'manifest.toml',
        line: Number(toml[1]),
        column: Number(toml[2])
      })
      continue
    }
    if (SUMMARY.test(line)) {
      inSummary = true
      recognized = true
      continue
    }
    if (inSummary) {
      const entry = ENTRY.exec(line)
      if (entry) {
        summary.push({ text: entry[1]?.trim() ?? '', more: [] })
        continue
      }
      const more = CONTINUATION.exec(line)
      const last = summary.at(-1)
      if (more?.[1] && last) {
        last.more.push(more[1].trim())
        continue
      }
      if (line.trim() !== '') inSummary = false
    }
    const warning = WARNING.exec(line)
    if (warning) {
      recognized = true
      const text = warning[1]?.trim() ?? ''
      if (text && !STAGING.test(text)) issues.push({ ...keyed(text), severity: 'warning' })
      continue
    }
    const failed = FAILURE.exec(line)
    if (failed?.[1]) {
      failure = failed[1].trim()
      continue
    }
    if (DONE.test(line.trim())) recognized = true
  }

  // The summary repeats the located `build-number` error as `build_number`: compared with
  // `_` read as `-`, so the table doesn't list it twice.
  const located = new Set(issues.map((issue) => normalize(issue.message)))
  for (const entry of summary) {
    if (GENERIC.test(entry.text) || entry.text === '') continue
    const issue: ValidationIssue = {
      ...keyed(entry.text),
      severity: 'error',
      ...(entry.more.length > 0 ? { help: entry.more.join('\n') } : {})
    }
    if (located.has(normalize(issue.message))) continue
    issues.push(issue)
  }

  const hasError = issues.some((issue) => issue.severity === 'error')
  if (result.exitCode === 0) {
    if (hasError || !recognized) throw unexpectedOutput('vpt validate', result.stdout)
    return { kind: 'validated', valid: true, issues: checked(issues, result.stdout) }
  }
  if (!recognized) {
    const last = result.stderr.trim().split('\n').at(-1)?.trim() ?? ''
    return { kind: 'failed', message: stripControl(failure ?? last) }
  }
  if (!hasError) {
    // Exit 1 with only generic entries: still invalid, so it shows as an error.
    const first = summary[0]?.text || 'vpt validate failed'
    issues.push({ ...keyed(first), severity: 'error' })
  }
  return { kind: 'validated', valid: false, issues: checked(issues, result.stdout) }
}

function keyed(text: string): { key?: string; message: string } {
  const bracket = /^\[([^\]\s]+)\] (.*)$/.exec(text)
  const message = (bracket?.[2] ?? text).trim().slice(0, MAX_TEXT) || text.trim()
  return bracket?.[1] ? { key: bracket[1], message } : { message }
}

// An unknown word is kept as a warning: never lost, never counted as an error.
function severity(word: string): ValidationSeverity {
  return SEVERITIES.has(word) ? (word as ValidationSeverity) : 'warning'
}

function normalize(message: string): string {
  return message.toLowerCase().replace(/_/g, '-').replace(/\s+/g, ' ').trim()
}

function checked(issues: ValidationIssue[], stdout: string): ValidationIssue[] {
  const bounded = issues.slice(0, MAX_ISSUES).map((issue) => ({
    ...issue,
    ...(issue.help ? { help: issue.help.slice(0, MAX_TEXT) } : {})
  }))
  const parsed = issuesSchema.safeParse(bounded)
  if (!parsed.success) throw unexpectedOutput('vpt validate', stdout)
  return bounded
}
