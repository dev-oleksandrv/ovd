import type { CheckStatus, DoctorReport } from '@ovd/core'

const MARK: Record<CheckStatus, string> = {
  ok: '✓',
  info: 'i',
  warn: '!',
  fail: '✗',
  skipped: '-'
}

export function doctorText(report: DoctorReport): string {
  const { host, checks } = report
  const width = Math.max(...checks.map((c) => c.name.length))
  const node = host.node === undefined ? '' : ` · Node ${host.node}`
  const lines = [`${host.os} ${host.osVersion} · ${host.arch}${node}`, '']
  for (const c of checks) {
    lines.push(`${MARK[c.status]} ${c.name.padEnd(width)}  ${c.detail}`)
    if (c.hint && (c.status === 'fail' || c.status === 'warn')) lines.push(`  → ${c.hint}`)
  }
  return `${lines.join('\n')}\n`
}
