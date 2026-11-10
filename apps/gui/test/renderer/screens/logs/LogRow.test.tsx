import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { LogRow } from '../../../../src/renderer/src/screens/logs/LogRow'
import { logEntry } from './sample'

function marks(): string[] {
  return Array.from(screen.getByRole('listitem').querySelectorAll('mark')).map(
    (m) => m.textContent ?? ''
  )
}

describe('LogRow', () => {
  test('a search hit in the tag only is marked in the tag', () => {
    // "amazon" is only in the tag (com.amazon.keplerscript), not in the message.
    render(<LogRow entry={logEntry(0)} search="amazon" regex={false} />)
    expect(marks()).toEqual(['amazon'])
    const mark = screen.getByText('amazon', { selector: 'mark' })
    expect(mark.closest('span.truncate')?.textContent).toBe('com.amazon.keplerscript')
  })

  test('a regex hit is marked in the tag and the message', () => {
    render(<LogRow entry={logEntry(7)} search={'kepler\\w+'} regex />)
    expect(marks()).toEqual(['keplerscript', 'KeplerScript'])
  })

  test('without a search nothing is marked', () => {
    render(<LogRow entry={logEntry(0)} search="" regex={false} />)
    expect(marks()).toEqual([])
  })

  test('an OVD row shows OVD in the level and tag columns, no pid, in the accent color', () => {
    const entry = logEntry(4, {
      deviceTime: null,
      priority: null,
      facility: null,
      process: null,
      pid: null,
      tid: null,
      tag: 'OVD',
      message: 'Log session restarted',
      ovd: { kind: 'restarted', reason: 'install' }
    })
    render(<LogRow entry={entry} search="" regex={false} />)
    const row = screen.getByRole('listitem')
    const cells = Array.from(row.children).map((c) => c.textContent)
    expect(cells.slice(1)).toEqual(['OVD', 'OVD', '', 'Log session restarted'])
    for (const i of [1, 2, 4]) expect(row.children[i]?.className).toContain('text-accent')
    expect(row.getAttribute('title')).toMatch(
      /^\d{2}:\d{2}:\d{2}\.\d{3} OVD Log session restarted$/
    )
  })
})
