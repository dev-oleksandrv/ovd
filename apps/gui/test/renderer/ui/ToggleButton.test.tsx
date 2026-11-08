import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { ToggleButton } from '../../../src/renderer/src/ui/ToggleButton'

describe('ToggleButton', () => {
  test.each([true, false])('shows aria-pressed=%s and toggles on click', (pressed) => {
    const onChange = vi.fn()
    render(
      <ToggleButton label="Regex" pressed={pressed} onChange={onChange} mono>
        .*
      </ToggleButton>
    )
    const button = screen.getByRole('button', { name: 'Regex' })
    expect(button.getAttribute('aria-pressed')).toBe(String(pressed))
    fireEvent.click(button)
    expect(onChange).toHaveBeenCalledWith(!pressed)
  })
})
