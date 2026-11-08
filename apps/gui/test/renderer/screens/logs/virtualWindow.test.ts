import { describe, expect, test } from 'vitest'
import { visibleRange } from '../../../../src/renderer/src/screens/logs/virtualWindow'

const at = (scrollTop: number, count = 1000) =>
  visibleRange({ scrollTop, viewportHeight: 220, rowHeight: 22, count, overscan: 5 })

describe('visibleRange', () => {
  test.each([
    ['top', 0, 1000, { start: 0, end: 15 }],
    ['middle', 2200, 1000, { start: 95, end: 115 }],
    ['bottom', 21780, 1000, { start: 985, end: 1000 }],
    ['empty', 0, 0, { start: 0, end: 0 }],
    ['fewer rows than fit', 0, 3, { start: 0, end: 3 }]
  ])('%s', (_n, scrollTop, count, range) => {
    expect(at(scrollTop, count)).toEqual(range)
  })
})
