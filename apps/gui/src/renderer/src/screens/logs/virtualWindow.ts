// The rows a virtualized list draws: the ones in the viewport plus `overscan` on each side.
// `end` is exclusive.
export function visibleRange(opts: {
  scrollTop: number
  viewportHeight: number
  rowHeight: number
  count: number
  overscan: number
}): { start: number; end: number } {
  const { scrollTop, viewportHeight, rowHeight, count, overscan } = opts
  if (count === 0 || rowHeight <= 0) return { start: 0, end: 0 }
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight)
  const last = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportHeight)) / rowHeight)
  const start = Math.min(count, Math.max(0, first - overscan))
  const end = Math.min(count, last + overscan)
  return { start, end: Math.max(start, end) }
}
