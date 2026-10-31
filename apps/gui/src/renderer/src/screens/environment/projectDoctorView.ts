import type { CheckStatus, ProjectDoctorReport } from '@ovd/core'

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

// The Details footer: "All checks passed", "1 warning", "2 checks failed, 2 warnings".
export function projectSummary(report: ProjectDoctorReport): { status: CheckStatus; text: string } {
  if (report.failed > 0) {
    const warnings = report.warnings > 0 ? `, ${plural(report.warnings, 'warning')}` : ''
    return { status: 'fail', text: `${plural(report.failed, 'check')} failed${warnings}` }
  }
  if (report.warnings > 0) return { status: 'warn', text: plural(report.warnings, 'warning') }
  return { status: 'ok', text: 'All checks passed' }
}

// Fix hints may hold a docs link; it renders as a link inside the text.
export function splitLink(text: string): { before: string; link: string | null; after: string } {
  const match = /https?:\/\/\S+/.exec(text)
  if (!match) return { before: text, link: null, after: '' }
  return {
    before: text.slice(0, match.index),
    link: match[0],
    after: text.slice(match.index + match[0].length)
  }
}
