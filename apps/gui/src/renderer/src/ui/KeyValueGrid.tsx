import { cx } from './cx'

export interface KeyValue {
  label: string
  value: string
  mono?: boolean
}

interface KeyValueGridProps {
  items: KeyValue[]
}

// Info tiles separated by hairlines, as on the device detail.
export function KeyValueGrid({ items }: KeyValueGridProps) {
  return (
    <dl className="grid shrink-0 grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-px overflow-hidden rounded-card border border-line-soft bg-line-soft">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col gap-1 bg-panel px-3.5 py-3">
          <dt className="text-label text-subtle">{item.label}</dt>
          <dd className={cx('m-0 text-body', item.mono && 'font-mono')}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
