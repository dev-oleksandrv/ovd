import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Tabs } from '../../../src/renderer/src/ui/Tabs'

describe('Tabs', () => {
  test('marks the selected tab and reports clicks', () => {
    const onChange = vi.fn()
    render(
      <Tabs
        items={[
          { id: 'installed', label: 'Installed · 3' },
          { id: 'running', label: 'Running · 1', badge: 2 }
        ]}
        value="installed"
        onChange={onChange}
      />
    )
    expect(screen.getByRole('tab', { name: 'Installed · 3' }).getAttribute('aria-selected')).toBe(
      'true'
    )
    screen.getByRole('tab', { name: /Running · 1/ }).click()
    expect(onChange).toHaveBeenCalledWith('running')
  })
})
