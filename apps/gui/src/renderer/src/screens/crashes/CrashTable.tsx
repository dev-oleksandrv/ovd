import type { Crash } from '@ovd/core'
import { Chip } from '../../ui/Chip'
import { Table, type Column } from '../../ui/Table'
import { ageText, crashSummary, kindLabel, metaLine } from './crashesView'

interface CrashTableProps {
  crashes: Crash[]
  deviceName: string
  now: Date
  // Whether a crash is NEW: appeared while OVD ran and not opened yet.
  isNew: (crash: Crash) => boolean
  selectedId: number | null
  onSelect: (crash: Crash) => void
}

// The list: kind chip, app, NEW, summary, `pid · build · device` and the age. Every string is
// device text or OVD-validated; React renders it as text, never as markup.
export function CrashTable({
  crashes,
  deviceName,
  now,
  isNew,
  selectedId,
  onSelect
}: CrashTableProps) {
  const columns: Array<Column<Crash>> = [
    {
      key: 'crash',
      header: 'Crash',
      width: 'minmax(0,1fr)',
      render: (c) => (
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <Chip mono>{kindLabel(c.kind)}</Chip>
            <span className="truncate font-mono font-semibold">{c.package}</span>
            {isNew(c) && <Chip variant="accent">NEW</Chip>}
          </div>
          <div className="truncate text-text-soft">{crashSummary(c)}</div>
          <div className="truncate font-mono text-label text-muted">{metaLine(c, deviceName)}</div>
        </div>
      )
    },
    {
      key: 'age',
      header: 'When',
      width: '110px',
      align: 'right',
      render: (c) => (
        <time dateTime={c.time} className="text-small text-muted">
          {ageText(c.time, now)}
        </time>
      )
    }
  ]
  return (
    <Table
      columns={columns}
      rows={crashes}
      rowKey={(c) => String(c.id)}
      {...(selectedId === null ? {} : { selectedKey: String(selectedId) })}
      onSelect={onSelect}
    />
  )
}
