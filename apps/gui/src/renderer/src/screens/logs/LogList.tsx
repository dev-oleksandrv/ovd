import type { LogEntry } from '@ovd/core'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LogRow, ROW_HEIGHT } from './LogRow'
import { visibleRange } from './virtualWindow'

const OVERSCAN = 20

interface LogListProps {
  entries: LogEntry[]
  // How many of `entries` to show (fewer while paused).
  count: number
  search: string
  regex: boolean
  follow: boolean
  onFollowChange: (follow: boolean) => void
  // The user reached the bottom with Follow off.
  onSeenBottom: () => void
  // Brings the row at `index` to the middle of the view (a crash's time); `n` tells two
  // requests for the same row apart.
  scrollTo?: { n: number; index: number } | null
}

// A virtualized list: a spacer as tall as every row, and only the rows in view drawn.
export function LogList({
  entries,
  count,
  search,
  regex,
  follow,
  onFollowChange,
  onSeenBottom,
  scrollTo = null
}: LogListProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(0)
  const total = count * ROW_HEIGHT

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setHeight(el.clientHeight)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setHeight(el.clientHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Follow: stay at the bottom after every update.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !follow) return
    const bottom = Math.max(0, total - el.clientHeight)
    el.scrollTop = bottom
    setScrollTop(bottom)
  }, [follow, total, height])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || scrollTo === null) return
    const top = Math.max(0, scrollTo.index * ROW_HEIGHT - el.clientHeight / 2)
    el.scrollTop = top
    setScrollTop(top)
  }, [scrollTo])

  const atBottom = (el: HTMLDivElement) => el.scrollTop + el.clientHeight >= total - ROW_HEIGHT

  // Rows that arrive while the user is at the bottom with Follow off count as seen.
  useEffect(() => {
    const el = ref.current
    if (el && !follow && atBottom(el)) onSeenBottom()
  })

  const { start, end } = visibleRange({
    scrollTop,
    viewportHeight: height,
    rowHeight: ROW_HEIGHT,
    count,
    overscan: OVERSCAN
  })
  const rows: LogEntry[] = entries.slice(start, end)

  return (
    <div
      ref={ref}
      role="list"
      aria-label="Log lines"
      onScroll={(event) => {
        const el = event.currentTarget
        setScrollTop(el.scrollTop)
        const bottom = atBottom(el)
        if (follow && !bottom) onFollowChange(false)
        else if (!follow && bottom) onSeenBottom()
      }}
      className="relative min-h-0 flex-1 overflow-auto bg-sunken"
    >
      <div style={{ height: total }} aria-hidden="true" />
      {rows.map((entry, i) => (
        <LogRow
          key={entry.seq}
          entry={entry}
          search={search}
          regex={regex}
          top={(start + i) * ROW_HEIGHT}
        />
      ))}
    </div>
  )
}
