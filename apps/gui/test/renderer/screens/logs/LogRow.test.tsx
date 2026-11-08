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
})
