import type { LogEntry } from '@ovd/core'
import type { ReactNode } from 'react'
import { highlightSegments, timeOfDay } from './logsView'

// Every row has the same height, so the list can place rows without measuring them.
export const ROW_HEIGHT = 22

const LEVEL_CLASS: Record<LogEntry['level'], string> = {
  D: 'text-log-d',
  I: 'text-log-i',
  W: 'text-log-w',
  E: 'text-log-e'
}

interface LogRowProps {
  entry: LogEntry
  search: string
  regex: boolean
  // Absolute position in the list (virtualized).
  top?: number
}

// One log entry: time, level, tag, pid and the first message line; the full text on hover.
// An OVD line (OVD's own event) shows OVD in the level and tag columns, no pid, in the accent
// color.
export function LogRow({ entry, search, regex, top }: LogRowProps) {
  const [first = '', ...rest] = entry.message.split('\n')
  const ovd = entry.ovd !== undefined
  const full = ovd
    ? `${timeOfDay(entry.time)} OVD ${entry.message}`
    : `${timeOfDay(entry.time)} ${entry.level} ${entry.tag} ${entry.pid ?? '-'} ${entry.message}`
  return (
    <div
      role="listitem"
      title={full}
      style={{ height: ROW_HEIGHT, ...(top === undefined ? {} : { top }) }}
      className={
        (top === undefined ? '' : 'absolute right-0 left-0 ') +
        'flex items-center gap-2.5 overflow-hidden px-4 font-mono text-small whitespace-nowrap hover:bg-row-hover'
      }
    >
      <span className="shrink-0 text-faint">{timeOfDay(entry.time)}</span>
      {/* Wide enough for "OVD", so the columns stay aligned on every row. */}
      <span
        className={`w-6 shrink-0 font-semibold ${ovd ? 'text-accent' : LEVEL_CLASS[entry.level]}`}
      >
        {ovd ? 'OVD' : entry.level}
      </span>
      <span className={`w-[180px] shrink-0 truncate ${ovd ? 'text-accent' : 'text-muted'}`}>
        {ovd ? 'OVD' : highlighted(entry.tag, search, regex)}
      </span>
      <span className="w-[52px] shrink-0 text-right text-subtle">
        {ovd ? '' : (entry.pid ?? '-')}
      </span>
      <span className={`min-w-0 truncate ${ovd ? 'text-accent' : 'text-text-soft'}`}>
        {highlighted(first, search, regex)}
      </span>
      {rest.length > 0 && (
        <span className="shrink-0 text-faint">
          +{rest.length} {rest.length === 1 ? 'line' : 'lines'}
        </span>
      )}
    </div>
  )
}

// The search hits in a text marked. Core's filter matches the message and the tag, so both
// show their hits the same way.
function highlighted(text: string, search: string, regex: boolean): ReactNode[] {
  return highlightSegments(text, search, regex).map((segment, i) =>
    segment.hit ? (
      <mark key={i} className="rounded-chip bg-accent/25 text-text">
        {segment.text}
      </mark>
    ) : (
      <span key={i}>{segment.text}</span>
    )
  )
}
