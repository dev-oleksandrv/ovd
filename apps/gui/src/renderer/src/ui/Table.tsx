import type { ReactNode } from 'react'
import { cx } from './cx'

export interface Column<Row> {
  key: string
  header: string
  // CSS grid track, e.g. 'minmax(0,2.2fr)' or '90px'.
  width: string
  align?: 'left' | 'right'
  render: (row: Row) => ReactNode
}

interface TableProps<Row> {
  columns: Array<Column<Row>>
  rows: Row[]
  rowKey: (row: Row) => string
  selectedKey?: string
  onSelect?: (row: Row) => void
}

export function Table<Row>({ columns, rows, rowKey, selectedKey, onSelect }: TableProps<Row>) {
  const template = { gridTemplateColumns: columns.map((c) => c.width).join(' ') }
  return (
    <div role="table" className="min-w-0">
      <div
        role="row"
        style={template}
        className="sticky top-0 grid border-b border-line bg-bg px-6 py-2.5 text-label tracking-[.06em] text-faint uppercase"
      >
        {columns.map((c) => (
          <div key={c.key} role="columnheader" className={cx(c.align === 'right' && 'text-right')}>
            {c.header}
          </div>
        ))}
      </div>
      {rows.map((row) => {
        const key = rowKey(row)
        return (
          <div
            key={key}
            role="row"
            aria-selected={selectedKey === undefined ? undefined : key === selectedKey}
            onClick={onSelect ? () => onSelect(row) : undefined}
            style={template}
            className={cx(
              'grid items-center border-b border-line-row px-6 py-3',
              onSelect && 'cursor-pointer hover:bg-row-hover',
              key === selectedKey && 'bg-row-hover'
            )}
          >
            {columns.map((c) => (
              <div
                key={c.key}
                role="cell"
                className={cx('min-w-0', c.align === 'right' && 'flex justify-end')}
              >
                {c.render(row)}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
