import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LogList } from '../../../../src/renderer/src/screens/logs/LogList'
import { ROW_HEIGHT } from '../../../../src/renderer/src/screens/logs/LogRow'
import { entries, logEntry } from './sample'

const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 800
  })
})
afterEach(() => {
  if (original) Object.defineProperty(HTMLElement.prototype, 'clientHeight', original)
})

function renderList(
  list = entries(100_000),
  opts: { follow?: boolean; onFollowChange?: (on: boolean) => void } = {}
) {
  render(
    <LogList
      entries={list}
      count={list.length}
      search=""
      regex={false}
      follow={opts.follow ?? false}
      onFollowChange={opts.onFollowChange ?? (() => undefined)}
      onSeenBottom={() => undefined}
    />
  )
  return screen.getByRole('list', { name: 'Log lines' })
}

describe('LogList', () => {
  test('100,000 entries draw only the rows in view', () => {
    renderList()
    const rows = screen.getAllByRole('listitem')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThanOrEqual(200)
    expect(screen.getByText('[KeplerScript-JavaScript] player flood 0')).toBeTruthy()
  })

  test('scrolling draws later rows', () => {
    const list = renderList()
    list.scrollTop = 50_000 * ROW_HEIGHT
    fireEvent.scroll(list)
    expect(screen.queryByText('[KeplerScript-JavaScript] player flood 0')).toBeNull()
    expect(screen.getByText('[KeplerScript-JavaScript] player flood 50010')).toBeTruthy()
    expect(screen.getAllByRole('listitem').length).toBeLessThanOrEqual(200)
  })

  test('Follow starts at the bottom; scrolling up turns it off', () => {
    const onFollowChange = vi.fn()
    const list = renderList(entries(100_000), { follow: true, onFollowChange })
    expect(screen.getByText('[KeplerScript-JavaScript] player flood 99999')).toBeTruthy()
    list.scrollTop = 1_000
    fireEvent.scroll(list)
    expect(onFollowChange).toHaveBeenCalledWith(false)
  })

  test('a multi-line entry shows +2 lines and its full text on hover', () => {
    renderList([logEntry(0, { message: 'player multi\nline two\nline three' })])
    expect(screen.getByText('+2 lines')).toBeTruthy()
    expect(screen.getByRole('listitem').getAttribute('title')).toContain(
      'player multi\nline two\nline three'
    )
  })
})
