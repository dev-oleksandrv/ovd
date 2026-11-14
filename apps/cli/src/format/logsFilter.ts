import { escapeControls, type LogFilterInput } from '@ovd/core'

// A value as it would be typed in a shell: bare when it is plain, else in single quotes. Control
// characters are escaped first, so a stored value can't move the cursor of the terminal.
function shellWord(value: string | number): string {
  const text = escapeControls(String(value))
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`
}

// A saved filter or preset as the `ovd logs` flags that make it, for the human `filter list`.
// Fields with no flag (the presets' apps-only and lifecycle) read as words.
export function filterSummary(filter: LogFilterInput): string {
  const parts: string[] = []
  const flag = (name: string, value: string | number | undefined) => {
    if (value !== undefined) parts.push(`${name} ${shellWord(value)}`)
  }
  const each = (name: string, values: readonly (string | number)[] | undefined) => {
    for (const value of values ?? []) flag(name, value)
  }
  flag('--app', filter.app)
  if (filter.system) parts.push('--system')
  if (filter.appsOnly) parts.push('apps only')
  if (filter.lifecycle) parts.push('lifecycle')
  flag('--level', filter.level)
  flag('--since', filter.since)
  flag('--until', filter.until)
  flag('--grep', filter.search)
  if (filter.regex) parts.push('--regex')
  each('--pid', filter.pid)
  each('--tid', filter.tid)
  each('--tag', filter.tag)
  each('--identity', filter.identity)
  each('--facility', filter.facility)
  each('--boot', filter.boot)
  for (const rule of filter.processRules ?? []) {
    if (rule.mute) flag('--mute', rule.identity)
    if (rule.level !== undefined) flag('--process-level', `${rule.identity}=${rule.level}`)
    if (rule.rate !== undefined) flag('--process-rate', `${rule.identity}=${rule.rate}`)
  }
  return parts.length === 0 ? 'everything' : parts.join(' ')
}
