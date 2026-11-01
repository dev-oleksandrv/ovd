import { unexpectedOutput } from './unexpectedOutput.js'

export type ProjectCheckStatus = 'ok' | 'warn' | 'fail'

export interface ProjectCheck {
  name: string
  status: ProjectCheckStatus
  message: string
}

export interface ProjectDoctorResult {
  checks: ProjectCheck[]
  // Bullet hints from the "To fix" lists, in order; links stay inside the text.
  fixes: string[]
  failed: number
  warnings: number
}

const MARKS: Record<string, ProjectCheckStatus> = { '✅': 'ok', '⚠️': 'warn', '❌': 'fail' }
// `  ✅ Name: message`. The name never holds ": ", the message may ("Run: vpt validate …").
const CHECK = /^\s+(✅|⚠️|❌)\s+(.+?):\s(.*)$/u
const FIX = /^\s+•\s+(.+)$/u

// `vega project doctor` has no JSON mode. Counts come from the check lines rather than the
// summary line, whose wording differs between passing and failing runs.
export function parseProjectDoctor(stdout: string): ProjectDoctorResult {
  const checks: ProjectCheck[] = []
  const fixes: string[] = []
  for (const line of stdout.split('\n')) {
    const check = CHECK.exec(line)
    if (check) {
      const [, mark = '', name = '', message = ''] = check
      const status = MARKS[mark]
      if (status) checks.push({ name, status, message: message.trim() })
      continue
    }
    const fix = FIX.exec(line)
    if (fix?.[1]) fixes.push(fix[1].trim())
  }
  if (checks.length === 0) throw unexpectedOutput('vega project doctor', stdout)
  return {
    checks,
    fixes,
    failed: checks.filter((c) => c.status === 'fail').length,
    warnings: checks.filter((c) => c.status === 'warn').length
  }
}
